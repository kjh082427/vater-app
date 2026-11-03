"""브리핑 만들기와 일정 루프 (스펙 6장).

- 만들기: 수집 → 해석(LLM 1회, 워커 스레드) → 저장 → Windows 알림·SSE·알림 이력. 한 번에 1건.
- LLM 문제(키 없음, 호출 실패, 읽을 수 없는 답)는 브리핑을 막지 않는다: 문장 없이 데이터만 저장하고
  `missing`에 `interpretation`을 남긴다.
- 일정: 1분마다 시장별로 지금 만들어야 할 세션을 확인한다.
  이미 있으면 건너뛰고, 실패하면 5분 뒤 다시.
- DB 쓰기는 이벤트 루프에서만 한다(LLM 호출만 `asyncio.to_thread`).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import sqlite3
from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime, time, timedelta
from typing import TYPE_CHECKING, Any

from vater_core.alerts.clock import KST, MarketClock
from vater_core.alerts.store import EventRepo
from vater_core.api.errors import VaterError
from vater_core.briefing.collect import Collected, Feeds, KisFeeds, collect
from vater_core.briefing.interpret import interpret
from vater_core.briefing.schedule import BriefingMarket, due_session
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

CollectFn = Callable[..., Awaitable[Collected]]
InterpretFn = Callable[[str, dict[str, Any], LlmRun], dict[str, str]]
NotifyFn = Callable[[str, str, str | None], None]


def _now_default() -> datetime:
    return datetime.now(UTC)


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
            base = {"market": market, "date": session.isoformat()}
            self._publish({**base, "status": "running"})
            try:
                got = await self._collect(
                    market, session, self._feeds_fn(), self._db(), alerts_until=self._now()
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
                text = await asyncio.to_thread(self._interpret, market, got.data, run)
            except Exception:  # LLM 문제는 브리핑을 막지 않는다 (사용자 규칙)
                logger.warning("briefing %s %s: saved without interpretation", market, session)
                missing.append("interpretation")
            db = self._db()
            bid = BriefingRepo(db).save(market, session, got.data, text, missing)
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

        deps.briefing = BriefingService(
            deps, clock=MarketClock(kr_trading_day), feeds_fn=feeds, run_fn=run
        )
    return deps.briefing
