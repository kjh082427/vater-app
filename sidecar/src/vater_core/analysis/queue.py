"""분석 작업 큐: 한 번에 1건씩 처리한다 (스펙 5장).

- 시작 전 확인(키, 로컬 모델, 한투 키, 종목)은 `submit`에서 바로 한다. 실패하면 행을 만들지 않는다.
- 엔진은 daemon 스레드에서 돈다. 앱을 끌 때 수십 분짜리 분석을 기다리지 않기 위해서다.
  TradingAgents 안의 스레드 풀은 daemon이 아니어서, 진입점은 남은 분석 스레드가 있으면
  프로세스를 바로 끝낸다(`abandoned_analysis_threads`). 끊긴 분석은 다음 시작 때
  `ANALYSIS_INTERRUPTED`가 되고, 같은 설정으로 [다시 시도]하면 체크포인트로 이어진다.
- DB 쓰기는 모두 이벤트 루프에서 한다. 엔진 스레드는 진행 이벤트만 보낸다(`EventBus`는 스레드 안전).
"""

import asyncio
import contextlib
import logging
import sqlite3
import threading
from collections.abc import Awaitable, Callable
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from vater_core.analysis.engine import AnalysisEngine, Cancelled
from vater_core.analysis.kis_vendor import KisBridge
from vater_core.analysis.models import EngineJob, Progress, TaPaths
from vater_core.analysis.store import AnalysisRepo
from vater_core.analysis.summary import decision_ko
from vater_core.analysis.symbols import Target, resolve_target
from vater_core.api.deps import AppDeps
from vater_core.api.errors import VaterError
from vater_core.api.events import EventBus
from vater_core.kis.quotes import is_domestic_trading_day
from vater_core.kis.services import require_kis
from vater_core.llm.presets import LlmRun, Preset, build_run
from vater_core.llm.state import get_llm
from vater_core.secrets.store import SecretStore
from vater_core.stdout_events import notify
from vater_core.store.settings import SettingsRepo

logger = logging.getLogger(__name__)
KST = ZoneInfo("Asia/Seoul")
NY = ZoneInfo("America/New_York")
KR_CLOSE = (15, 40)  # 장 마감(15:30) 뒤 일봉이 확정된 시각
US_CLOSE = (16, 10)
MAX_LOOKBACK_DAYS = 14
THREAD_NAME = "vater-analysis"

NotifyFn = Callable[[str, str, str], None]
LatestDayFn = Callable[[Target], Awaitable[date]]


def _not_cancellable(status: str) -> VaterError:
    return VaterError(
        "ANALYSIS_NOT_CANCELLABLE", f"이미 끝난 분석은 취소할 수 없습니다 ({status}).", status=409
    )


def _run_in_daemon_thread[T](fn: Callable[[], T]) -> "asyncio.Future[T]":
    loop = asyncio.get_running_loop()
    future: asyncio.Future[T] = loop.create_future()

    def settle(ok: bool, value: Any) -> None:
        if future.done():
            return
        if ok:
            future.set_result(value)
        else:
            future.set_exception(value)

    def target() -> None:
        try:
            value = fn()
        except BaseException as e:  # 결과를 루프로 넘긴다
            if not loop.is_closed():
                loop.call_soon_threadsafe(settle, False, e)
            return
        if not loop.is_closed():
            loop.call_soon_threadsafe(settle, True, value)

    threading.Thread(target=target, name=THREAD_NAME, daemon=True).start()
    return future


class AnalysisQueue:
    def __init__(
        self,
        deps: AppDeps,
        engine: AnalysisEngine,
        *,
        latest_day: LatestDayFn | None = None,
        notify_fn: NotifyFn = notify,
    ) -> None:
        self._deps = deps
        self._engine = engine
        self._latest_day = latest_day or self._default_latest_day
        self._notify = notify_fn
        self._pending: asyncio.Queue[int] | None = None
        self._cancels: dict[int, threading.Event] = {}
        self._worker: asyncio.Task[None] | None = None
        self.running_id: int | None = None

    # ---- 공용 ------------------------------------------------------------

    def _db(self) -> sqlite3.Connection:
        if self._deps.db is None:
            raise VaterError("DB_UNAVAILABLE", "저장소가 준비되지 않았습니다.", status=503)
        return self._deps.db

    def _repo(self) -> AnalysisRepo:
        return AnalysisRepo(self._db())

    def _secrets(self) -> SecretStore:
        if self._deps.secrets is None:
            raise VaterError("SECRETS_UNAVAILABLE", "키 저장소가 준비되지 않았습니다.", status=503)
        return self._deps.secrets

    def _events(self) -> EventBus | None:
        return self._deps.events

    def _publish(self, type: str, data: dict[str, Any]) -> None:
        events = self._events()
        if events is not None:
            events.publish(type, data)

    async def _prepare(self, market: str, code: str, preset: str | None) -> tuple[Target, LlmRun]:
        """분석을 시작할 수 있는지 확인한다. 실패하면 그 이유의 오류를 그대로 낸다."""
        db = self._db()
        target = resolve_target(db, market, code)
        llm = get_llm(self._deps)
        settings = SettingsRepo(db).get_all()
        run = build_run(settings, llm.catalog, self._secrets(), preset=preset)  # type: ignore[arg-type]
        if target.domestic:
            require_kis(self._deps)
        local = sorted({t.model for t in (run.deep, run.quick) if t.provider == "ollama"})
        if local:
            await llm.ollama.start()  # 꺼져 있으면 자동 실행을 시도한다 (스펙 8장)
            for name in local:
                await llm.ollama.require_model(name)
        return target, run

    async def _default_latest_day(self, target: Target) -> date:
        """최근 거래일: 장 마감 뒤면 오늘, 아니면 그 전 거래일."""
        if not target.domestic:
            now = datetime.now(NY)
            day = now.date() if (now.hour, now.minute) >= US_CLOSE else now.date() - timedelta(1)
            while day.weekday() >= 5:
                day -= timedelta(days=1)
            return day
        now = datetime.now(KST)
        day = now.date() if (now.hour, now.minute) >= KR_CLOSE else now.date() - timedelta(1)
        client = require_kis(self._deps).client
        for _ in range(MAX_LOOKBACK_DAYS):
            try:
                if await is_domestic_trading_day(client, day):
                    return day
            except VaterError:  # 휴장일 정보를 못 받으면 주말만 거른다
                if day.weekday() < 5:
                    return day
            day -= timedelta(days=1)
        return day

    # ---- 제출·취소·재시도 ---------------------------------------------------

    async def submit(
        self, market: str, code: str, as_of: date | None, preset: Preset | None
    ) -> int:
        target, run = await self._prepare(market, code, preset)
        today = datetime.now(KST if target.domestic else NY).date()
        if as_of is not None and as_of > today:
            raise VaterError(
                "REQUEST_INVALID",
                f"기준일({as_of})이 오늘보다 늦습니다.",
                hint="기준일을 비워 두면 최근 거래일로 분석합니다.",
                status=422,
            )
        day = as_of or await self._latest_day(target)
        aid = self._repo().create(target, day.isoformat(), run.preset)
        self._cancels[aid] = threading.Event()
        self._queue().put_nowait(aid)
        self._publish("analysis.status", {"id": aid, "status": "queued"})
        return aid

    async def cancel(self, aid: int) -> str:
        repo = self._repo()
        a = repo.get(aid)
        if a.status == "queued":
            repo.cancel(aid)
            self._cancels.pop(aid, threading.Event()).set()
            self._publish("analysis.status", {"id": aid, "status": "cancelled"})
            return "cancelled"
        if a.status == "running" and aid in self._cancels:
            self._cancels[aid].set()  # 엔진이 다음 노드 경계에서 멈춘다
            return "cancelling"
        raise _not_cancellable(a.status)

    async def retry(self, aid: int) -> int:
        a = self._repo().get(aid)
        if a.status not in ("failed", "cancelled"):
            raise VaterError(
                "ANALYSIS_NOT_RETRYABLE",
                "실패하거나 취소한 분석만 다시 시도할 수 있습니다.",
                hint="새로 분석하려면 [분석 시작]을 누르세요.",
                status=409,
            )
        # 같은 종목·기준일·프리셋이면 TradingAgents 체크포인트로 끝난 단계를 건너뛴다 (S5)
        return await self.submit(a.market, a.code, date.fromisoformat(a.as_of), a.preset)  # type: ignore[arg-type]

    # ---- 워커 ------------------------------------------------------------

    def _queue(self) -> asyncio.Queue[int]:
        if self._pending is None:
            self._pending = asyncio.Queue()
        return self._pending

    def start(self) -> None:
        if self._worker is None:
            self._worker = asyncio.get_running_loop().create_task(self._work())

    async def stop(self) -> None:
        for event in self._cancels.values():
            event.set()
        if self._worker is not None:
            self._worker.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._worker
            self._worker = None

    async def _work(self) -> None:
        while True:
            aid = await self._queue().get()
            try:
                await self._run_one(aid)
            except asyncio.CancelledError:
                raise
            except Exception:  # 큐는 멈추지 않는다
                logger.exception("analysis worker failed on %s", aid)

    def _on_progress(self, aid: int) -> Callable[[Progress], None]:
        def publish(p: Progress) -> None:  # 엔진 스레드에서 불린다
            self._publish(
                "analysis.progress",
                {"id": aid, "stage": p.stage, "node": p.node, "elapsed_sec": p.elapsed_sec},
            )

        return publish

    async def _run_one(self, aid: int) -> None:
        repo = self._repo()
        a = repo.get(aid)
        cancel = self._cancels.get(aid)
        if a.status != "queued" or cancel is None:
            return  # 기다리는 동안 취소됨
        name = a.name or a.code
        self.running_id = aid
        try:
            target, run = await self._prepare(a.market, a.code, a.preset)
            if cancel.is_set() or repo.get(aid).status != "queued":
                return  # 확인하는 사이에 취소됨 (취소 쪽에서 상태와 이벤트를 이미 처리했다)
            models = {
                "deep": {"provider": run.deep.provider, "model": run.deep.model},
                "quick": {"provider": run.quick.provider, "model": run.quick.model},
            }
            repo.set_running(aid, models)
            self._publish("analysis.status", {"id": aid, "status": "running"})
            loop = asyncio.get_running_loop()
            bridge = KisBridge(require_kis(self._deps).client, loop) if target.domestic else None
            job = EngineJob(
                aid, target, date.fromisoformat(a.as_of), run, TaPaths.under(self._deps.data_dir)
            )
            progress = self._on_progress(aid)
            result = await _run_in_daemon_thread(
                lambda: self._engine.run(job, progress, cancel, bridge)
            )
        except Cancelled:
            repo.cancel(aid)
            self._publish("analysis.status", {"id": aid, "status": "cancelled"})
        except VaterError as e:
            self._fail(repo, aid, name, e.code, e.message, e.hint)
        except Exception as e:
            # 원문에는 키가 섞일 수 있다: 로그(마스킹됨)에만 남기고 DB·이벤트에는 종류만 쓴다.
            logger.exception("analysis %s failed", aid)
            self._fail(
                repo,
                aid,
                name,
                "ANALYSIS_FAILED",
                f"분석 중 오류가 났습니다 ({type(e).__name__}).",
                "다시 시도하거나 설정 > 로그 폴더에서 원인을 확인하세요.",
            )
        else:
            repo.finish(aid, result)
            decision = result.summary.decision
            self._publish("analysis.status", {"id": aid, "status": "done", "decision": decision})
            self._notify("분석 완료", f"{name}: {decision_ko(decision)}", f"/analyses/{aid}")
        finally:
            self.running_id = None
            self._cancels.pop(aid, None)

    def _fail(
        self, repo: AnalysisRepo, aid: int, name: str, code: str, message: str, hint: str | None
    ) -> None:
        repo.fail(aid, code, message, hint)
        error = {"code": code, "message": message, "hint": hint}
        self._publish("analysis.status", {"id": aid, "status": "failed", "error": error})
        self._notify("분석 실패", f"{name}: {message}", f"/analyses/{aid}")


def abandoned_analysis_threads() -> list[str]:
    """아직 돌고 있는 분석 스레드. 종료할 때 있으면 진입점이 프로세스를 바로 끝낸다."""
    return [t.name for t in threading.enumerate() if t.name == THREAD_NAME and t.is_alive()]


def get_analysis(deps: AppDeps) -> AnalysisQueue:
    """처음 부를 때 TradingAgents 엔진으로 만들고 워커를 시작한다."""
    if deps.analysis is None:
        from vater_core.analysis.engine import TradingAgentsEngine

        deps.analysis = AnalysisQueue(deps, TradingAgentsEngine())
        deps.analysis.start()
    return deps.analysis
