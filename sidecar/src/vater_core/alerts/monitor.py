"""알림 감시 루프 (스펙 4-2, 7-3, 8장).

`tick_once()`를 일정 간격(최대 30초, 폴링 간격이 더 짧으면 그 간격)마다 돈다.
- 열린 시장: realtime 규칙이 있는 종목을 WebSocket에 구독한다(한도 안). 한도를 넘은 종목과
  WebSocket이 끊긴 동안의 모든 종목은 `alerts.poll_interval_sec`마다 REST 현재가로 평가한다.
- 닫힌 시장: 구독을 푼다.
- 마감 평가: 일봉이 확정된 가장 최근 세션(마감 + 10분)을 종목마다 한 번씩 평가한다. 앱이 그 시간에
  꺼져 있었어도 다음 실행 때 따라잡는다. 그 세션의 봉이 아직 없거나 조회가 실패하면 어제 값으로
  판정하지 않고 5분 뒤 다시 받는다. 장중 지표(신고가 등)도 이렇게 받은 전 세션까지의 일봉을 쓴다.
- 틱은 종목별로 1초에 최대 1번 평가한다. 그 사이의 틱은 최신가만 남겨 두었다가 1초가 차면 평가한다.
- 인터넷이 끊기면(`KIS_UNREACHABLE`, 연결 오류) `offline`.
  다음 회차에 다시 시도하고 복구되면 재개한다.
- 상태가 바뀌면 SSE `alerts.state` `{state, realtime, polling}`을 보낸다.

DB 쓰기(평가)는 모두 이벤트 루프 스레드에서 한다. 틱 콜백도 루프에서 불린다.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime, timedelta
from typing import TYPE_CHECKING, Any, Protocol, cast

import httpx

from vater_core.alerts.clock import MarketClock, MarketId
from vater_core.alerts.evaluator import Evaluator, NotifyFn, NowFn
from vater_core.alerts.rules import Live
from vater_core.alerts.store import BarRepo, RuleRepo, WatchItem, WatchlistRepo
from vater_core.api.errors import VaterError
from vater_core.kis.models import Quote, UsExchange
from vater_core.kis.ws import DOMESTIC_TR, US_TR, Tick
from vater_core.stdout_events import notify
from vater_core.store.settings import SettingsRepo

if TYPE_CHECKING:
    from vater_core.api.deps import AppDeps

logger = logging.getLogger(__name__)

TICK_SEC = 30.0
CLOSE_RETRY = timedelta(minutes=5)  # 마감 평가용 일봉을 다시 받기까지 기다리는 시간
MARKETS: tuple[MarketId, ...] = ("KR", "US")
OFFLINE_CODES = {"KIS_UNREACHABLE"}
Key = tuple[str, str]


class Realtime(Protocol):
    @property
    def state(self) -> str: ...
    @property
    def subscription_errors(self) -> dict[tuple[str, str], str]: ...

    async def subscribe(self, market: Any, code: str, exchange: Any = None) -> bool: ...
    async def unsubscribe(self, market: Any, code: str, exchange: Any = None) -> None: ...
    async def run(self) -> None: ...


RealtimeFactory = Callable[[Callable[[Tick], None], Callable[[str], None], int], Realtime]
PriceFn = Callable[[WatchItem], Awaitable[Quote]]
BarsFn = Callable[[WatchItem, date], Awaitable[int]]
SleepFn = Callable[[float], Awaitable[None]]


class _Offline(Exception):
    pass


def _now_default() -> datetime:
    return datetime.now(UTC)


def _is_offline(e: BaseException) -> bool:
    if isinstance(e, VaterError):
        return e.code in OFFLINE_CODES
    return isinstance(e, httpx.TransportError)


def _key(item: WatchItem) -> Key:
    return item.market, item.code


def _ws_key(item: WatchItem) -> tuple[str, str]:
    """KisRealtime이 구독을 구분하는 (tr_id, tr_key)."""
    if item.market == "KR":
        return DOMESTIC_TR, item.code
    return US_TR, f"D{item.exchange}{item.code}"


class AlertMonitor:
    def __init__(
        self,
        deps: AppDeps,
        *,
        clock: MarketClock,
        realtime_factory: RealtimeFactory,
        price_fn: PriceFn,
        bars_fn: BarsFn,
        sleep: SleepFn = asyncio.sleep,
        notify_fn: NotifyFn = notify,
        now: NowFn = _now_default,
        throttle: float = 1.0,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self._deps = deps
        self._clock = clock
        self._realtime_factory = realtime_factory
        self._price = price_fn
        self._bars = bars_fn
        self._sleep = sleep
        self._notify = notify_fn
        self._now = now
        self._throttle = throttle
        self._monotonic = monotonic  # 틱 1초 제한용 시계 (테스트에서 바꾼다)

        self._paused = False
        self._state = "closed"
        self._counts = (0, 0)  # (realtime, polling)
        self._published: dict[str, Any] | None = None
        self._loop_task: asyncio.Task[None] | None = None
        self._rt: Realtime | None = None
        self._rt_task: asyncio.Task[None] | None = None

        self._subscribed: dict[Key, WatchItem] = {}
        self._session_day: dict[str, date] = {}
        self._last_poll: dict[Key, datetime] = {}
        self._close_done: dict[Key, date] = {}  # 종목별로 마감 평가를 마친 세션 날짜
        self._close_retry: dict[Key, tuple[date, datetime]] = {}  # (세션, 다시 받을 시각)
        self._last_eval: dict[Key, float] = {}
        self._pending: dict[Key, Tick] = {}

    # ---- 공용 ----------------------------------------------------------------

    def _db(self) -> Any:
        if self._deps.db is None:
            raise VaterError("DB_UNAVAILABLE", "저장소가 준비되지 않았습니다.", status=503)
        return self._deps.db

    def _evaluator(self) -> Evaluator:
        return Evaluator(self._db(), self._deps.events, self._notify, self._now)

    def status(self) -> dict[str, Any]:
        state = "paused" if self._paused else self._state
        return {"state": state, "realtime": self._counts[0], "polling": self._counts[1]}

    def _publish_status(self) -> None:
        status = self.status()
        if status != self._published:
            self._published = status
            if self._deps.events is not None:
                self._deps.events.publish("alerts.state", status)

    def pause(self) -> None:
        self._paused = True
        self._publish_status()

    def resume(self) -> None:
        self._paused = False
        self._publish_status()

    # ---- 수명 ----------------------------------------------------------------

    def start(self) -> None:
        if self._loop_task is None:
            self._loop_task = asyncio.get_running_loop().create_task(self._run())

    async def stop(self) -> None:
        tasks = [t for t in (self._loop_task, self._rt_task) if t is not None]
        self._loop_task = self._rt_task = None
        self._rt = None
        for t in tasks:
            t.cancel()
        for t in tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await t

    def _interval(self) -> float:
        poll = int(SettingsRepo(self._db()).get("alerts.poll_interval_sec"))
        return min(TICK_SEC, float(poll))

    async def _run(self) -> None:
        while True:
            try:
                await self.tick_once()
            except asyncio.CancelledError:
                raise
            except Exception:  # 한 회차가 실패해도 감시는 계속된다
                logger.exception("alert monitor tick failed")
            await self._sleep(self._interval())

    # ---- 한 회차 -------------------------------------------------------------

    async def tick_once(self) -> None:
        if self._paused:
            self._publish_status()
            return
        offline = False
        any_open = False
        realtime = polling = 0
        try:
            items = WatchlistRepo(self._db()).list()
            rules = RuleRepo(self._db()).list(enabled_only=True)
            timings: dict[int, set[str]] = {}
            for r in rules:
                timings.setdefault(r.watchlist_id, set()).add(r.timing)
            for market in MARKETS:
                mine = [i for i in items if i.market == market]
                await self._close_pass(market, mine, timings)
                if await self._clock.is_open(market):
                    any_open = True
                    live_items = [i for i in mine if "realtime" in timings.get(i.id, set())]
                    rt, polled = await self._open_market(market, live_items)
                    realtime += rt
                    polling += polled
                else:
                    await self._unsubscribe_market(market)
        except _Offline:
            offline = True
        except VaterError as e:
            if e.code != "KIS_NOT_CONFIGURED":
                raise
            logger.debug("alert monitor idle: KIS keys are not configured")
        self._stop_realtime_if_idle()
        self._state = "offline" if offline else ("running" if any_open else "closed")
        self._counts = (realtime, polling)
        self._publish_status()

    async def _guard(self, item: WatchItem, call: Awaitable[Any]) -> Any:
        """종목 1개의 한투 호출.

        인터넷 끊김은 회차 전체를 멈추고, 나머지 오류는 그 종목만 건너뛴다.
        """
        try:
            return await call
        except Exception as e:
            if _is_offline(e):
                raise _Offline from e
            if isinstance(e, VaterError) and e.code == "KIS_NOT_CONFIGURED":
                raise
            logger.warning("alert monitor: %s %s failed: %s", item.market, item.code, e)
            return None

    async def _open_market(self, market: MarketId, items: list[WatchItem]) -> tuple[int, int]:
        self._session_day[market] = await self._clock.session_date(market)
        wanted = {_key(i): i for i in items}
        rt = self._ensure_realtime() if items else self._rt
        for key in [k for k in self._subscribed if k[0] == market and k not in wanted]:
            await self._unsubscribe(self._subscribed[key])
        on_realtime: list[WatchItem] = []
        if rt is not None:
            for item in items:
                if await rt.subscribe(item.market, item.code, item.exchange or None):
                    self._subscribed[_key(item)] = item
                    on_realtime.append(item)
        connected = rt is not None and rt.state == "connected"
        rejected = rt.subscription_errors if rt is not None else {}
        live_keys = (
            {_key(i) for i in on_realtime if _ws_key(i) not in rejected} if connected else set()
        )
        to_poll = [i for i in items if _key(i) not in live_keys]

        now = self._now()
        interval = timedelta(seconds=int(SettingsRepo(self._db()).get("alerts.poll_interval_sec")))
        for item in to_poll:
            last = self._last_poll.get(_key(item))
            if last is not None and now - last < interval:
                continue
            quote = await self._guard(item, self._price(item))
            self._last_poll[_key(item)] = now
            if quote is not None:
                self._evaluate_live(item, quote.price, quote.change_pct, quote.volume)
        return len(live_keys), len(to_poll)

    async def _close_pass(
        self, market: MarketId, items: list[WatchItem], timings: dict[int, set[str]]
    ) -> None:
        if not items:
            return
        day = await self._clock.last_closed_session(market)
        if day is None:
            return
        now = self._now()
        bars = BarRepo(self._db())
        evaluator = self._evaluator()
        for item in items:
            key = _key(item)
            if self._close_done.get(key) == day:
                continue
            retry = self._close_retry.get(key)
            if retry is not None and retry[0] == day and now < retry[1]:
                continue
            saved = await self._guard(item, self._bars(item, day))  # 인터넷 끊김은 여기서 멈춘다
            last = bars.last_day(item.market, item.code)
            if saved is None or last is None or last < day:
                # 그 세션의 확정 봉이 아직 없다: 어제 값으로 '그날 종가'를 판정하지 않는다
                self._close_retry[key] = (day, now + CLOSE_RETRY)
                continue
            if "close" in timings.get(item.id, set()):
                rules = RuleRepo(self._db()).list(item.id, enabled_only=True)
                history = bars.history(item.market, item.code)
                evaluator.evaluate(item, rules, history, None, day)
            self._close_done[key] = day

    # ---- 실시간 ---------------------------------------------------------------

    def _ensure_realtime(self) -> Realtime | None:
        if self._rt is not None:
            return self._rt
        limit = int(SettingsRepo(self._db()).get("kis.ws_max_subscriptions"))
        try:
            rt = self._realtime_factory(self._on_tick, self._on_realtime_state, limit)
        except VaterError as e:
            if e.code == "KIS_NOT_CONFIGURED":
                raise
            logger.warning("alert monitor: realtime unavailable, polling instead: %s", e)
            return None
        self._rt = rt
        self._rt_task = asyncio.get_running_loop().create_task(rt.run())
        return rt

    def _on_realtime_state(self, state: str) -> None:
        logger.info("KIS realtime %s", state)

    async def _unsubscribe(self, item: WatchItem) -> None:
        self._subscribed.pop(_key(item), None)
        self._pending.pop(_key(item), None)
        if self._rt is not None:
            await self._rt.unsubscribe(item.market, item.code, item.exchange or None)

    async def _unsubscribe_market(self, market: str) -> None:
        for key in [k for k in self._subscribed if k[0] == market]:
            await self._unsubscribe(self._subscribed[key])

    def _stop_realtime_if_idle(self) -> None:
        if self._rt is not None and not self._subscribed:
            if self._rt_task is not None:
                self._rt_task.cancel()
            self._rt = self._rt_task = None

    def _on_tick(self, tick: Tick) -> None:
        if self._paused:
            return
        key = (tick.market, tick.code)
        if key not in self._subscribed:
            return
        elapsed = self._monotonic() - self._last_eval.get(key, float("-inf"))
        if elapsed >= self._throttle:
            self._pending.pop(key, None)  # 미뤄 둔 틱은 이 틱보다 오래됐다
            self._evaluate_tick(key, tick)
            return
        if key not in self._pending:
            asyncio.get_running_loop().call_later(self._throttle - elapsed, self._flush, key)
        self._pending[key] = tick

    def _flush(self, key: Key) -> None:
        tick = self._pending.pop(key, None)
        if tick is not None and not self._paused and key in self._subscribed:
            self._evaluate_tick(key, tick)

    def _evaluate_tick(self, key: Key, tick: Tick) -> None:
        self._last_eval[key] = self._monotonic()
        self._evaluate_live(self._subscribed[key], tick.price, tick.change_pct, tick.volume)

    def _evaluate_live(self, item: WatchItem, price: float, change_pct: float, volume: int) -> None:
        day = self._session_day.get(item.market)
        if day is None:
            return
        try:
            rules = RuleRepo(self._db()).list(item.id, enabled_only=True)
            history = BarRepo(self._db()).history(item.market, item.code)
            live = Live(day=day, price=price, change_pct=change_pct, volume=volume)
            self._evaluator().evaluate(item, rules, history, live, day)
        except Exception:  # 틱 하나의 평가 실패가 실시간 수신을 멈추지 않게 한다
            logger.exception("alert evaluation failed for %s %s", item.market, item.code)


def get_alerts(deps: AppDeps) -> AlertMonitor:
    """처음 부를 때 한투 현재가·일봉·실시간으로 조립한다. 키는 호출할 때마다 확인한다."""
    if deps.alerts is None:
        from vater_core.alerts.bars import refresh_bars
        from vater_core.kis.quotes import domestic_price, is_domestic_trading_day, overseas_price
        from vater_core.kis.services import require_kis
        from vater_core.kis.ws import KisRealtime

        async def kr_trading_day(day: date) -> bool:
            return await is_domestic_trading_day(require_kis(deps).client, day)

        async def price(item: WatchItem) -> Quote:
            client = require_kis(deps).client
            if item.market == "KR":
                return await domestic_price(client, item.code)
            return await overseas_price(client, cast(UsExchange, item.exchange), item.code)

        async def bars(item: WatchItem, through: date) -> int:
            client = require_kis(deps).client
            if deps.db is None:
                raise VaterError("DB_UNAVAILABLE", "저장소가 준비되지 않았습니다.", status=503)
            return await refresh_bars(client, BarRepo(deps.db), item, through)

        def realtime(
            on_tick: Callable[[Tick], None], on_state: Callable[[str], None], limit: int
        ) -> Realtime:
            kis = require_kis(deps)
            return KisRealtime(kis.tokens, kis.server, on_tick, on_state, limit)

        deps.alerts = AlertMonitor(
            deps,
            clock=MarketClock(kr_trading_day),
            realtime_factory=realtime,
            price_fn=price,
            bars_fn=bars,
        )
    return deps.alerts
