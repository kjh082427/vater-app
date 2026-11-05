"""브리핑 만들기와 일정 루프 (스펙 6장).

- 만들기: 수집 → 해석(LLM 1회, 워커 스레드) → 내 자산 → 저장 → 알림·SSE·알림 이력. 한 번에 1건.
- 내 자산은 해석이 끝난 뒤에 계산하고 저장에만 넘긴다. `got.data`에 넣지 않는다(v2 설계 8-1, 15장).
- LLM 문제(키 없음, 호출 실패, 읽을 수 없는 답)는 브리핑을 막지 않는다: 문장 없이 데이터만 저장하고
  `missing`에 `interpretation`을 남긴다.
- 일정: 1분마다 시장별로 지금 만들어야 할 세션을 확인한다.
  이미 있으면 건너뛰고, 실패하면 5분 뒤 다시.
- DB 쓰기는 이벤트 루프에서만 한다. LLM 호출만 daemon 스레드에서 돌리고 시간 제한을 둔다
  (응답이 멈춰도 앱 종료와 다음 브리핑을 막지 않는다).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import sqlite3
import threading
from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime, time, timedelta
from typing import TYPE_CHECKING, Any

from vater_core.alerts.clock import KST, MarketClock
from vater_core.alerts.store import EventRepo
from vater_core.api.errors import VaterError
from vater_core.briefing.collect import Collected, Feeds, KisFeeds, collect
from vater_core.briefing.interpret import interpret
from vater_core.briefing.schedule import BriefingMarket, due_session, next_open
from vater_core.briefing.store import BriefingRepo
from vater_core.llm.presets import LlmRun
from vater_core.stdout_events import notify
from vater_core.store.settings import SettingsRepo

if TYPE_CHECKING:
    from vater_core.api.deps import AppDeps

logger = logging.getLogger(__name__)

MARKETS: tuple[BriefingMarket, ...] = ("KR", "US")
LABEL = {"KR": "국내", "US": "미국"}
LOOP_SEC = 60.0
RETRY = timedelta(minutes=5)
LLM_TIMEOUT_SEC = 900.0  # Gemini 무료 등급 실측 약 6분
LLM_THREAD = "vater-briefing-llm"

CollectFn = Callable[..., Awaitable[Collected]]
InterpretFn = Callable[[str, dict[str, Any], LlmRun], dict[str, str]]
NotifyFn = Callable[[str, str, str | None], None]
AssetsFn = Callable[[BriefingMarket, date], Awaitable[dict[str, Any] | None]]


def _now_default() -> datetime:
    return datetime.now(UTC)


def _in_daemon_thread(fn: Callable[[], Any]) -> asyncio.Future[Any]:
    """`fn`을 daemon 스레드에서 돌린다. 기다리다 그만둬도 스레드가 앱 종료를 막지 않는다."""
    loop = asyncio.get_running_loop()
    future: asyncio.Future[Any] = loop.create_future()

    def settle(ok: bool, value: Any) -> None:
        if future.done():  # 시간 초과로 이미 포기했다
            return
        if ok:
            future.set_result(value)
        else:
            future.set_exception(value)

    def target() -> None:
        try:
            value = fn()
        except BaseException as e:
            if not loop.is_closed():
                loop.call_soon_threadsafe(settle, False, e)
            return
        if not loop.is_closed():
            loop.call_soon_threadsafe(settle, True, value)

    threading.Thread(target=target, name=LLM_THREAD, daemon=True).start()
    return future


def _busy() -> VaterError:
    return VaterError(
        "BRIEFING_BUSY", "브리핑을 만드는 중입니다.", "끝난 뒤 다시 시도하세요.", status=409
    )


class BriefingService:
    def __init__(
        self,
        deps: AppDeps,
        *,
        clock: MarketClock,
        feeds_fn: Callable[[], Feeds],
        run_fn: Callable[[], LlmRun],
        collect_fn: CollectFn = collect,
        interpret_fn: InterpretFn = interpret,
        notify_fn: NotifyFn = notify,
        now: Callable[[], datetime] = _now_default,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        llm_timeout: float = LLM_TIMEOUT_SEC,
        assets_fn: AssetsFn | None = None,
    ) -> None:
        self._deps = deps
        self._clock = clock
        self._feeds_fn = feeds_fn
        self._run_fn = run_fn
        self._collect = collect_fn
        self._interpret = interpret_fn
        self._notify = notify_fn
        self._now = now
        self._sleep = sleep
        self._llm_timeout = llm_timeout
        self._assets = assets_fn
        self._lock = asyncio.Lock()
        self._retry_at: dict[tuple[str, date], datetime] = {}
        self._loop_task: asyncio.Task[None] | None = None
        self._manual: asyncio.Task[None] | None = None

    def _db(self) -> sqlite3.Connection:
        if self._deps.db is None:
            raise VaterError("DB_UNAVAILABLE", "저장소가 준비되지 않았습니다.", status=503)
        return self._deps.db

    def _publish(self, data: dict[str, Any]) -> None:
        if self._deps.events is not None:
            self._deps.events.publish("briefing.status", data)

    def busy(self) -> bool:
        return self._lock.locked() or (self._manual is not None and not self._manual.done())

    # ---- 만들기 ----------------------------------------------------------------

    async def generate(self, market: BriefingMarket, session: date) -> int:
        if self._lock.locked():
            raise _busy()
        async with self._lock:
            feeds = self._feeds_fn()  # 한투 키가 없으면 여기서 멈춘다: 진행 이벤트를 보내지 않는다
            base = {"market": market, "date": session.isoformat()}
            self._publish({**base, "status": "running"})
            try:
                got = await self._collect(
                    market, session, feeds, self._db(), alerts_until=self._now()
                )
            except Exception as e:
                code = e.code if isinstance(e, VaterError) else "BRIEFING_FAILED"
                message = e.message if isinstance(e, VaterError) else type(e).__name__
                self._publish(
                    {**base, "status": "failed", "error": {"code": code, "message": message}}
                )
                raise
            missing = list(got.missing)
            text: dict[str, str] | None = None
            try:
                run = self._run_fn()
                call = _in_daemon_thread(lambda: self._interpret(market, got.data, run))
                text = await asyncio.wait_for(call, self._llm_timeout)
            except Exception as e:  # LLM 문제는 브리핑을 막지 않는다 (사용자 규칙)
                cause = e.code if isinstance(e, VaterError) else type(e).__name__
                logger.warning(
                    "briefing %s %s: saved without interpretation (%s)", market, session, cause
                )
                missing.append("interpretation")
            assets: dict[str, Any] | None = None
            if self._assets is not None:
                try:
                    assets = await self._assets(market, session)
                except Exception as e:  # 보유가 있는데 계산하지 못했다. 브리핑은 막지 않는다
                    logger.warning(
                        "briefing %s %s: my assets failed: %s", market, session, type(e).__name__
                    )
                    missing.append("my_assets")
            db = self._db()
            bid = BriefingRepo(db).save(market, session, got.data, text, missing, assets)
            label = LABEL[market]
            self._notify(
                "오늘의 시장 브리핑",
                f"{label} {session.month}/{session.day} 브리핑이 도착했습니다",
                f"/briefings/{bid}",
            )
            stamp = self._now().astimezone(KST).isoformat(timespec="seconds")
            EventRepo(db).add(None, stamp, None, f"시장 브리핑 도착: {label} {session.isoformat()}")
            status = "partial" if missing else "done"
            self._publish({**base, "status": status, "id": bid})
            return bid

    async def run_latest(self, market: BriefingMarket) -> date:
        """수동 실행: 일봉이 확정된 가장 최근 세션을 백그라운드로 만든다."""
        if self.busy():
            raise _busy()
        session = await self._clock.last_closed_session(market)
        if session is None:
            raise VaterError(
                "BRIEFING_NO_SESSION", "브리핑을 만들 최근 거래일이 없습니다.", status=409
            )
        if self._now() >= await next_open(market, session, self._clock):
            # 지수·순위는 '지금' 값만 받을 수 있어서, 다음 장이 열린 뒤에는 지난 세션을 만들 수 없다
            raise VaterError(
                "BRIEFING_NO_SESSION",
                "지금은 지난 거래일 브리핑을 만들 수 없습니다.",
                "다음 장이 열려 있어 데이터가 섞입니다. 오늘 장 마감 10분 뒤에 다시 시도하세요.",
                status=409,
            )
        if self.busy():
            raise _busy()

        async def run() -> None:
            try:
                await self.generate(market, session)
            except Exception:
                logger.exception("manual briefing %s %s failed", market, session)

        self._manual = asyncio.get_running_loop().create_task(run())
        return session

    # ---- 일정 -------------------------------------------------------------------

    async def tick_once(self) -> None:
        settings = SettingsRepo(self._db())
        for market in MARKETS:
            key = market.lower()
            if not settings.get(f"briefing.{key}.enabled"):
                continue
            now = self._now()
            at = time.fromisoformat(settings.get(f"briefing.{key}.time"))
            session = await due_session(market, now, self._clock, at)
            if session is None or BriefingRepo(self._db()).find(market, session) is not None:
                continue
            retry = self._retry_at.get((market, session))
            if retry is not None and now < retry:
                continue
            try:
                await self.generate(market, session)
            except Exception as e:
                self._retry_at[(market, session)] = now + RETRY
                if isinstance(e, VaterError) and e.code == "KIS_NOT_CONFIGURED":
                    logger.debug("briefing %s skipped: KIS keys are not configured", market)
                else:
                    logger.warning("briefing %s %s failed, retrying later: %s", market, session, e)

    def start(self) -> None:
        if self._loop_task is None:
            self._loop_task = asyncio.get_running_loop().create_task(self._run())

    async def _run(self) -> None:
        while True:
            try:
                await self.tick_once()
            except asyncio.CancelledError:
                raise
            except Exception:  # 한 회차가 실패해도 일정은 계속된다
                logger.exception("briefing schedule tick failed")
            await self._sleep(LOOP_SEC)

    async def stop(self) -> None:
        tasks = [t for t in (self._loop_task, self._manual) if t is not None]
        self._loop_task = self._manual = None
        for t in tasks:
            t.cancel()
        for t in tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await t


def get_briefing(deps: AppDeps) -> BriefingService:
    """처음 부를 때 한투 수집과 설정의 LLM 프리셋으로 조립한다. 키는 쓸 때마다 확인한다."""
    if deps.briefing is None:
        from vater_core.kis.quotes import is_domestic_trading_day
        from vater_core.kis.services import require_kis
        from vater_core.llm.catalog import load_catalog
        from vater_core.llm.presets import build_run
        from vater_core.portfolio.daily import get_daily

        async def kr_trading_day(day: date) -> bool:
            return await is_domestic_trading_day(require_kis(deps).client, day)

        def feeds() -> Feeds:
            return KisFeeds(require_kis(deps).client)

        def run() -> LlmRun:
            if deps.db is None or deps.secrets is None:
                raise VaterError(
                    "SECRETS_UNAVAILABLE", "키 저장소가 준비되지 않았습니다.", status=503
                )
            return build_run(SettingsRepo(deps.db).get_all(), load_catalog(), deps.secrets)

        async def assets(market: BriefingMarket, session: date) -> dict[str, Any] | None:
            return await get_daily(deps).my_assets(market, session)

        deps.briefing = BriefingService(
            deps,
            clock=MarketClock(kr_trading_day),
            feeds_fn=feeds,
            run_fn=run,
            assets_fn=assets,
        )
    return deps.briefing
