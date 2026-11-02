"""분석 작업 큐. 엔진은 가짜로 바꿔 끼운다."""

import asyncio
import sqlite3
import threading
from collections.abc import Callable
from datetime import date
from typing import Any

import pytest

from vater_core.analysis.engine import Cancelled
from vater_core.analysis.kis_vendor import KisBridge
from vater_core.analysis.models import EngineJob, EngineResult, Progress
from vater_core.analysis.queue import AnalysisQueue
from vater_core.analysis.store import AnalysisRepo
from vater_core.analysis.summary import DecisionSummary
from vater_core.analysis.symbols import Target
from vater_core.api.deps import AppDeps
from vater_core.api.errors import VaterError
from vater_core.secrets.names import SecretName

DAY = date(2026, 11, 2)
FAKE_KEY = "g-secret-key-987"


class FakeEngine:
    def __init__(
        self,
        gate: threading.Event | None = None,
        error: Exception | None = None,
        decision: str = "Hold",
    ) -> None:
        self.gate = gate
        self.error = error
        self.decision = decision
        self.jobs: list[EngineJob] = []
        self.kis: list[KisBridge | None] = []

    def run(
        self,
        job: EngineJob,
        on_progress: Any,
        cancel: threading.Event,
        kis: KisBridge | None,
    ) -> EngineResult:
        self.jobs.append(job)
        self.kis.append(kis)
        on_progress(Progress("analysts", "Market Analyst", 1.0))
        if self.gate is not None:
            while not (self.gate.is_set() or cancel.is_set()):
                cancel.wait(0.01)
        if cancel.is_set():
            raise Cancelled
        if self.error is not None:
            raise self.error
        on_progress(Progress("portfolio", "Portfolio Manager", 2.0))
        return EngineResult(
            summary=DecisionSummary(self.decision, ("요약.",), None, None),  # type: ignore[arg-type]
            reports={"final_trade_decision": f"**Rating**: {self.decision}"},
            timings={"analysts": 1.0, "portfolio": 1.0},
            tokens={"in": 10, "out": 5},
        )


@pytest.fixture(autouse=True)
def _seeded(deps: AppDeps, seed: Callable[[sqlite3.Connection], None]) -> None:
    assert deps.db is not None
    seed(deps.db)


async def latest(target: Target) -> date:
    return DAY


def make_queue(
    deps: AppDeps, engine: FakeEngine, notes: list[tuple[str, str, str]]
) -> AnalysisQueue:
    assert deps.secrets is not None
    deps.secrets.set(SecretName.LLM_GOOGLE_KEY, FAKE_KEY)
    deps.secrets.set(SecretName.KIS_APP_KEY, "ak")
    deps.secrets.set(SecretName.KIS_APP_SECRET, "as")
    q = AnalysisQueue(
        deps, engine, latest_day=latest, notify_fn=lambda t, b, r: notes.append((t, b, r))
    )
    q.start()
    return q


async def wait_status(deps: AppDeps, aid: int, *statuses: str) -> str:
    assert deps.db is not None
    repo = AnalysisRepo(deps.db)
    for _ in range(300):
        status = repo.get(aid).status
        if status in statuses:
            return status
        await asyncio.sleep(0.01)
    raise AssertionError(f"analysis {aid} stuck in {repo.get(aid).status}")


async def test_submit_runs_and_saves_result(deps: AppDeps) -> None:
    notes: list[tuple[str, str, str]] = []
    engine = FakeEngine()
    q = make_queue(deps, engine, notes)
    assert deps.events is not None
    sub = deps.events.subscribe()
    try:
        aid = await q.submit("KR", "005930", None, None)
        assert await wait_status(deps, aid, "done") == "done"
    finally:
        await q.stop()
    assert deps.db is not None
    a = AnalysisRepo(deps.db).get(aid)
    assert a.decision == "Hold" and a.summary == ["요약."] and a.as_of == "2026-11-02"
    assert a.models == {
        "deep": {"provider": "google", "model": "gemini-3.8-flash"},
        "quick": {"provider": "google", "model": "gemini-3.5-flash-lite"},
    }
    events = []
    while not sub.queue.empty():
        ev = sub.queue.get_nowait()
        events.append((ev.type, ev.data.get("status") or ev.data.get("node")))
    assert events == [
        ("analysis.status", "queued"),
        ("analysis.status", "running"),
        ("analysis.progress", "Market Analyst"),
        ("analysis.progress", "Portfolio Manager"),
        ("analysis.status", "done"),
    ]
    assert notes == [("분석 완료", "삼성전자: 보유", f"/analyses/{aid}")]
    assert engine.jobs[0].target.ticker == "005930.KS"
    assert engine.kis[0] is not None  # 국내 종목은 한투 공급자를 쓴다


async def test_us_symbol_has_no_kis_bridge(deps: AppDeps) -> None:
    engine = FakeEngine()
    q = make_queue(deps, engine, [])
    try:
        aid = await q.submit("US", "AAPL", DAY, "cloud")
        await wait_status(deps, aid, "done")
    finally:
        await q.stop()
    assert engine.kis == [None] and engine.jobs[0].target.ticker == "AAPL"


async def test_jobs_run_one_at_a_time(deps: AppDeps) -> None:
    gate = threading.Event()
    engine = FakeEngine(gate=gate)
    q = make_queue(deps, engine, [])
    try:
        first = await q.submit("KR", "005930", None, None)
        second = await q.submit("US", "AAPL", None, None)
        await wait_status(deps, first, "running")
        await asyncio.sleep(0.05)
        assert deps.db is not None
        assert AnalysisRepo(deps.db).get(second).status == "queued"
        assert q.running_id == first
        gate.set()
        await wait_status(deps, second, "done")
    finally:
        await q.stop()
    assert [j.id for j in engine.jobs] == [first, second]


async def test_cancel_queued_and_running(deps: AppDeps) -> None:
    gate = threading.Event()
    engine = FakeEngine(gate=gate)
    q = make_queue(deps, engine, [])
    try:
        running = await q.submit("KR", "005930", None, None)
        queued = await q.submit("US", "AAPL", None, None)
        await wait_status(deps, running, "running")
        assert await q.cancel(queued) == "cancelled"
        assert await q.cancel(running) == "cancelling"
        assert await wait_status(deps, running, "cancelled") == "cancelled"
        await asyncio.sleep(0.05)
        assert len(engine.jobs) == 1  # 취소한 대기 작업은 실행하지 않는다
        with pytest.raises(VaterError) as e:
            await q.cancel(running)
        assert (e.value.code, e.value.status) == ("ANALYSIS_NOT_CANCELLABLE", 409)
    finally:
        await q.stop()


async def test_engine_error_marks_failed_and_continues(deps: AppDeps) -> None:
    notes: list[tuple[str, str, str]] = []
    engine = FakeEngine(error=RuntimeError(f"provider said: bad key {FAKE_KEY}"))
    q = make_queue(deps, engine, notes)
    assert deps.events is not None
    sub = deps.events.subscribe()
    try:
        aid = await q.submit("KR", "005930", None, None)
        await wait_status(deps, aid, "failed")
        engine.error = None
        nxt = await q.submit("US", "AAPL", None, None)
        await wait_status(deps, nxt, "done")
    finally:
        await q.stop()
    assert deps.db is not None
    a = AnalysisRepo(deps.db).get(aid)
    assert a.error is not None and a.error["code"] == "ANALYSIS_FAILED"
    assert FAKE_KEY not in str(a.error)
    seen = []
    while not sub.queue.empty():
        seen.append(str(sub.queue.get_nowait().data))
    assert all(FAKE_KEY not in s for s in seen)
    assert notes[0][0] == "분석 실패" and FAKE_KEY not in notes[0][1]


async def test_vater_error_keeps_its_code(deps: AppDeps) -> None:
    engine = FakeEngine(error=VaterError("LLM_UNREACHABLE", "연결 실패", "다시 시도", 503))
    q = make_queue(deps, engine, [])
    try:
        aid = await q.submit("US", "AAPL", None, None)
        await wait_status(deps, aid, "failed")
    finally:
        await q.stop()
    assert deps.db is not None
    assert AnalysisRepo(deps.db).get(aid).error == {
        "code": "LLM_UNREACHABLE",
        "message": "연결 실패",
        "hint": "다시 시도",
    }


async def test_submit_checks_before_queueing(deps: AppDeps) -> None:
    q = make_queue(deps, FakeEngine(), [])
    assert deps.db is not None and deps.secrets is not None
    try:
        deps.secrets.delete(SecretName.LLM_GOOGLE_KEY)
        with pytest.raises(VaterError) as e:
            await q.submit("US", "AAPL", None, None)
        assert e.value.code == "LLM_KEY_MISSING"
        deps.secrets.set(SecretName.LLM_GOOGLE_KEY, FAKE_KEY)
        deps.secrets.delete(SecretName.KIS_APP_KEY)
        with pytest.raises(VaterError) as e:
            await q.submit("KR", "005930", None, None)
        assert e.value.code == "KIS_NOT_CONFIGURED"
        with pytest.raises(VaterError) as e:
            await q.submit("KR", "999999", None, None)
        assert e.value.code == "SYMBOL_UNKNOWN"
    finally:
        await q.stop()
    assert AnalysisRepo(deps.db).list() == []


async def test_retry_copies_parameters(deps: AppDeps) -> None:
    engine = FakeEngine(error=RuntimeError("boom"))
    q = make_queue(deps, engine, [])
    try:
        aid = await q.submit("US", "AAPL", date(2026, 10, 30), "cloud")
        await wait_status(deps, aid, "failed")
        engine.error = None
        again = await q.retry(aid)
        await wait_status(deps, again, "done")
        with pytest.raises(VaterError) as e:
            await q.retry(again)
        assert (e.value.code, e.value.status) == ("ANALYSIS_NOT_RETRYABLE", 409)
    finally:
        await q.stop()
    assert deps.db is not None
    a = AnalysisRepo(deps.db).get(again)
    assert (a.market, a.code, a.as_of, a.preset) == ("US", "AAPL", "2026-10-30", "cloud")
    assert again != aid


async def test_stop_does_not_wait_for_running_engine(deps: AppDeps) -> None:
    """앱 종료가 실행 중인 분석(수십 분)을 기다리지 않는다. 다음 시작 때 '중단됨'이 된다."""
    gate = threading.Event()  # 끝까지 열지 않는다
    q = make_queue(deps, FakeEngine(gate=gate), [])
    aid = await q.submit("US", "AAPL", None, None)
    await wait_status(deps, aid, "running")
    await asyncio.wait_for(q.stop(), timeout=1.0)
    gate.set()
