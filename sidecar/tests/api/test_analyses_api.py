"""분석 API. 엔진은 가짜, 큐는 실제(AnalysisQueue)를 쓴다."""

import asyncio
import threading
from collections.abc import AsyncIterator, Callable
from datetime import date
from pathlib import Path
from typing import Any

import httpx
import pytest

from vater_core.analysis.engine import Cancelled
from vater_core.analysis.models import EngineResult, Progress, TaPaths
from vater_core.analysis.queue import AnalysisQueue
from vater_core.analysis.store import AnalysisRepo
from vater_core.analysis.summary import DecisionSummary
from vater_core.analysis.symbols import Target
from vater_core.api.deps import AppDeps
from vater_core.secrets.names import SecretName

SYMBOLS = [
    ("KR", "005930", "KOSPI", "삼성전자", None, "stock"),
    ("US", "AAPL", "NAS", "애플", "APPLE INC", "stock"),
]


class Engine:
    def __init__(self) -> None:
        self.decisions = ["Buy", "Sell"]
        self.gate: threading.Event | None = None

    def run(self, job: Any, on_progress: Any, cancel: threading.Event, kis: Any) -> EngineResult:
        on_progress(Progress("analysts", "Market Analyst", 1.0))
        if self.gate is not None:
            while not (self.gate.is_set() or cancel.is_set()):
                cancel.wait(0.01)
        if cancel.is_set():
            raise Cancelled
        decision = self.decisions.pop(0) if self.decisions else "Hold"
        return EngineResult(
            summary=DecisionSummary(decision, ("근거 1.", "근거 2."), "250000", "3-6 months"),  # type: ignore[arg-type]
            reports={"market_report": "차트", "final_trade_decision": f"**Rating**: {decision}"},
            timings={"analysts": 1.0},
            tokens={"in": 10, "out": 5},
        )


async def latest(target: Target) -> date:
    return date(2026, 11, 2)


@pytest.fixture
async def queue(deps: AppDeps) -> AsyncIterator[AnalysisQueue]:
    assert deps.db is not None and deps.secrets is not None
    deps.db.executemany(
        "INSERT INTO symbols (market, code, exchange, name, name_en, kind) VALUES (?,?,?,?,?,?)",
        SYMBOLS,
    )
    deps.db.commit()
    deps.secrets.set(SecretName.LLM_GOOGLE_KEY, "g-key")
    deps.secrets.set(SecretName.KIS_APP_KEY, "ak")
    deps.secrets.set(SecretName.KIS_APP_SECRET, "as")
    q = AnalysisQueue(deps, Engine(), latest_day=latest, notify_fn=lambda *a: None)
    q.start()
    deps.analysis = q
    yield q
    await q.stop()


async def until(client: httpx.AsyncClient, aid: int, status: str) -> dict[str, Any]:
    for _ in range(300):
        body: dict[str, Any] = (await client.get(f"/analyses/{aid}")).json()
        if body["status"] == status:
            return body
        await asyncio.sleep(0.01)
    raise AssertionError(f"analysis {aid} never reached {status}")


async def test_create_and_read(client: httpx.AsyncClient, queue: AnalysisQueue) -> None:
    r = await client.post("/analyses", json={"market": "KR", "code": "005930"})
    assert r.status_code == 202
    aid = r.json()["id"]
    assert r.json()["status"] == "queued"
    body = await until(client, aid, "done")
    assert body["name"] == "삼성전자" and body["as_of"] == "2026-11-02"
    assert body["decision"] == "Buy" and body["decision_ko"] == "매수"
    assert body["summary"] == ["근거 1.", "근거 2."]
    assert body["price_target"] == "250000" and body["time_horizon"] == "3-6 months"
    assert body["reports"]["market_report"] == "차트"
    assert body["models"]["deep"] == {
        "provider": "google",
        "model": "gemini-3.8-flash",
        "fallbacks": [],
    }
    assert body["tokens"] == {"in": 10, "out": 5} and body["error"] is None


async def test_list_marks_decision_change(client: httpx.AsyncClient, queue: AnalysisQueue) -> None:
    first = (await client.post("/analyses", json={"market": "KR", "code": "005930"})).json()["id"]
    await until(client, first, "done")
    second = (await client.post("/analyses", json={"market": "KR", "code": "005930"})).json()["id"]
    await until(client, second, "done")
    items = (await client.get("/analyses", params={"market": "KR", "code": "005930"})).json()
    assert [(i["id"], i["decision"], i["decision_changed"]) for i in items] == [
        (second, "Sell", True),
        (first, "Buy", False),
    ]
    assert "reports" not in items[0]  # 목록은 가볍게
    assert len((await client.get("/analyses", params={"limit": 1})).json()) == 1


async def test_create_with_options(client: httpx.AsyncClient, queue: AnalysisQueue) -> None:
    r = await client.post(
        "/analyses",
        json={"market": "US", "code": "AAPL", "as_of": "2026-10-30", "preset": "cloud"},
    )
    body = await until(client, r.json()["id"], "done")
    assert body["as_of"] == "2026-10-30" and body["preset"] == "cloud"


async def test_create_errors(
    client: httpx.AsyncClient, queue: AnalysisQueue, deps: AppDeps
) -> None:
    r = await client.post("/analyses", json={"market": "KR", "code": "999999"})
    assert r.status_code == 404 and r.json()["code"] == "SYMBOL_UNKNOWN"
    r = await client.post("/analyses", json={"market": "JP", "code": "7203"})
    assert r.status_code == 422 and r.json()["code"] == "REQUEST_INVALID"
    assert deps.secrets is not None
    deps.secrets.delete(SecretName.LLM_GOOGLE_KEY)
    r = await client.post("/analyses", json={"market": "US", "code": "AAPL"})
    assert r.status_code == 409 and r.json()["code"] == "LLM_KEY_MISSING"


async def test_cancel_and_retry(client: httpx.AsyncClient, queue: AnalysisQueue) -> None:
    engine = queue._engine
    assert isinstance(engine, Engine)
    engine.gate = threading.Event()
    aid = (await client.post("/analyses", json={"market": "US", "code": "AAPL"})).json()["id"]
    await until(client, aid, "running")
    r = await client.post(f"/analyses/{aid}/cancel")
    assert r.json() == {"id": aid, "status": "cancelling"}
    await until(client, aid, "cancelled")
    r = await client.post(f"/analyses/{aid}/cancel")
    assert r.status_code == 409 and r.json()["code"] == "ANALYSIS_NOT_CANCELLABLE"
    engine.gate = None
    r = await client.post(f"/analyses/{aid}/retry")
    assert r.status_code == 202 and r.json()["id"] != aid
    await until(client, r.json()["id"], "done")


async def test_unknown_analysis(client: httpx.AsyncClient, queue: AnalysisQueue) -> None:
    for method, path in [
        ("GET", "/analyses/999"),
        ("POST", "/analyses/999/cancel"),
        ("POST", "/analyses/999/retry"),
    ]:
        r = await client.request(method, path)
        assert r.status_code == 404 and r.json()["code"] == "ANALYSIS_NOT_FOUND"


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/analyses"),
        ("GET", "/analyses"),
        ("GET", "/analyses/1"),
        ("POST", "/analyses/1/cancel"),
        ("POST", "/analyses/1/retry"),
        ("DELETE", "/analyses/1"),
        ("POST", "/analyses/delete"),
    ],
)
async def test_routes_require_token(anon_client: httpx.AsyncClient, method: str, path: str) -> None:
    assert (await anon_client.request(method, path)).status_code == 401


def test_recover_runs_at_startup(deps: AppDeps) -> None:
    """사이드카가 시작할 때 중단된 분석을 정리한다."""
    from vater_core.__main__ import recover_analyses

    assert deps.db is not None
    deps.db.executemany(
        "INSERT INTO symbols (market, code, exchange, name, name_en, kind) VALUES (?,?,?,?,?,?)",
        SYMBOLS,
    )
    repo = AnalysisRepo(deps.db)
    from vater_core.analysis.symbols import resolve_target

    aid = repo.create(resolve_target(deps.db, "US", "AAPL"), "2026-11-02", "cloud")
    assert recover_analyses(deps.db) == 1
    assert repo.get(aid).status == "failed"


# ---- 분석 이력 삭제 (v2 설계 21장 1번) --------------------------------------------

Make = Callable[[Path, str, str, str], str]
DAY = "2026-11-02"


def cache_dir(deps: AppDeps) -> Path:
    return TaPaths.under(deps.data_dir).data_cache_dir


def threads(deps: AppDeps, ticker: str) -> set[str]:
    from tradingagents.graph.checkpointer import get_checkpointer

    with get_checkpointer(cache_dir(deps), ticker) as saver:
        rows = saver.conn.execute("SELECT DISTINCT thread_id FROM checkpoints").fetchall()
    return {r[0] for r in rows}


def row(deps: AppDeps, status: str, code: str = "005930", as_of: str = DAY) -> int:
    """엔진을 거치지 않고 상태만 정한 분석 하나."""
    assert deps.db is not None
    market = "KR" if code == "005930" else "US"
    cur = deps.db.execute(
        "INSERT INTO analyses (market, code, as_of, preset, status, reports) "
        "VALUES (?, ?, ?, 'cloud', ?, '{}')",
        (market, code, as_of, status),
    )
    deps.db.commit()
    assert cur.lastrowid is not None
    return cur.lastrowid


async def test_delete_removes_the_row_the_report_and_its_checkpoint(
    client: httpx.AsyncClient, queue: AnalysisQueue, deps: AppDeps, make_checkpoint: Make
) -> None:
    aid = row(deps, "failed")
    other_day = make_checkpoint(cache_dir(deps), "005930.KS", "2026-11-03", "cloud")
    make_checkpoint(cache_dir(deps), "005930.KS", DAY, "cloud")
    sub = deps.events.subscribe() if deps.events else None

    r = await client.delete(f"/analyses/{aid}")

    assert (r.status_code, r.content) == (204, b"")
    assert (await client.get(f"/analyses/{aid}")).status_code == 404
    assert aid not in [i["id"] for i in (await client.get("/analyses")).json()]
    assert threads(deps, "005930.KS") == {other_day}  # 다른 날 분석의 것은 그대로
    assert sub is not None and sub.queue.get_nowait().data == {"ids": [aid]}


async def test_delete_a_finished_analysis_through_the_real_queue(
    client: httpx.AsyncClient, queue: AnalysisQueue
) -> None:
    aid = (await client.post("/analyses", json={"market": "US", "code": "AAPL"})).json()["id"]
    await until(client, aid, "done")
    assert (await client.delete(f"/analyses/{aid}")).status_code == 204
    assert (await client.get(f"/analyses/{aid}")).status_code == 404


@pytest.mark.parametrize("status", ["queued", "running"])
async def test_delete_refuses_an_analysis_in_progress(
    client: httpx.AsyncClient,
    queue: AnalysisQueue,
    deps: AppDeps,
    make_checkpoint: Make,
    status: str,
) -> None:
    aid = row(deps, status)
    tid = make_checkpoint(cache_dir(deps), "005930.KS", DAY, "cloud")

    r = await client.delete(f"/analyses/{aid}")

    assert (r.status_code, r.json()["code"]) == (409, "ANALYSIS_IN_PROGRESS")
    assert (await client.get(f"/analyses/{aid}")).status_code == 200
    assert threads(deps, "005930.KS") == {tid}


async def test_delete_unknown_analysis(client: httpx.AsyncClient, queue: AnalysisQueue) -> None:
    r = await client.delete("/analyses/99")
    assert (r.status_code, r.json()["code"]) == (404, "ANALYSIS_NOT_FOUND")


async def test_a_checkpoint_another_analysis_may_resume_is_kept(
    client: httpx.AsyncClient, queue: AnalysisQueue, deps: AppDeps, make_checkpoint: Make
) -> None:
    """실패한 분석 둘이 같은 종목·기준일의 체크포인트를 이어 쓴다: 마지막 하나를 지울 때 지운다."""
    first, second = row(deps, "failed"), row(deps, "failed")
    tid = make_checkpoint(cache_dir(deps), "005930.KS", DAY, "cloud")

    assert (await client.delete(f"/analyses/{first}")).status_code == 204
    assert threads(deps, "005930.KS") == {tid}
    assert (await client.delete(f"/analyses/{second}")).status_code == 204
    assert threads(deps, "005930.KS") == set()


async def test_deleting_a_running_retrys_source_keeps_the_checkpoint(
    client: httpx.AsyncClient, queue: AnalysisQueue, deps: AppDeps, make_checkpoint: Make
) -> None:
    failed, retry = row(deps, "failed"), row(deps, "running")
    tid = make_checkpoint(cache_dir(deps), "005930.KS", DAY, "cloud")
    assert (await client.delete(f"/analyses/{failed}")).status_code == 204
    assert threads(deps, "005930.KS") == {tid}
    assert (await client.get(f"/analyses/{retry}")).status_code == 200


async def test_bulk_delete_reports_what_it_skipped(
    client: httpx.AsyncClient, queue: AnalysisQueue, deps: AppDeps, make_checkpoint: Make
) -> None:
    done, failed = row(deps, "done", "AAPL"), row(deps, "failed")
    running = row(deps, "running", "AAPL", "2026-11-03")
    make_checkpoint(cache_dir(deps), "005930.KS", DAY, "cloud")
    sub = deps.events.subscribe() if deps.events else None

    r = await client.post("/analyses/delete", json={"ids": [done, failed, running, 99, done]})

    assert r.status_code == 200
    assert r.json() == {
        "deleted": [done, failed],
        "skipped": [
            {"id": running, "code": "ANALYSIS_IN_PROGRESS"},
            {"id": 99, "code": "ANALYSIS_NOT_FOUND"},
        ],
    }
    assert [i["id"] for i in (await client.get("/analyses")).json()] == [running]
    assert threads(deps, "005930.KS") == set()
    assert sub is not None and sub.queue.get_nowait().data == {"ids": [done, failed]}
    assert sub.queue.empty()


async def test_bulk_delete_limits_the_count(
    client: httpx.AsyncClient, queue: AnalysisQueue
) -> None:
    ok = await client.post("/analyses/delete", json={"ids": list(range(1, 51))})
    assert ok.status_code == 200
    for ids in (list(range(1, 52)), [], [0], ["a"]):
        r = await client.post("/analyses/delete", json={"ids": ids})
        assert (r.status_code, r.json()["code"]) == (422, "REQUEST_INVALID")


async def test_history_events_stay_without_a_link_to_the_deleted_analysis(
    client: httpx.AsyncClient, queue: AnalysisQueue, deps: AppDeps
) -> None:
    """알림 이력(분석 완료·실패)은 분석 id를 담지 않는다. 지워도 이력 줄만 남고 이동할 곳이 없다."""
    from vater_core.alerts.store import EventRepo

    assert deps.db is not None
    aid = row(deps, "failed")
    EventRepo(deps.db).add(None, "2026-11-03T10:00:00+09:00", None, "AI 분석 실패: 삼성전자 — 오류")
    await client.delete(f"/analyses/{aid}")
    [event] = (await client.get("/alerts/events")).json()
    assert event["message"].startswith("AI 분석 실패")
    assert set(event) == {
        "id",
        "rule_id",
        "fired_at",
        "value",
        "message",
        "market",
        "code",
        "name",
        "kind",
    }


async def test_deleting_a_cancelled_queued_analysis_does_not_trouble_the_worker(
    client: httpx.AsyncClient, queue: AnalysisQueue, caplog: pytest.LogCaptureFixture
) -> None:
    engine = queue._engine
    assert isinstance(engine, Engine)
    engine.gate = threading.Event()
    first = (await client.post("/analyses", json={"market": "US", "code": "AAPL"})).json()["id"]
    await until(client, first, "running")
    second = (await client.post("/analyses", json={"market": "US", "code": "AAPL"})).json()["id"]
    assert (await client.post(f"/analyses/{second}/cancel")).json()["status"] == "cancelled"
    assert (await client.delete(f"/analyses/{second}")).status_code == 204  # 큐에는 id가 남아 있다

    with caplog.at_level("ERROR"):
        engine.gate.set()
        await until(client, first, "done")
        third = (await client.post("/analyses", json={"market": "US", "code": "AAPL"})).json()["id"]
        await until(client, third, "done")  # 워커가 계속 돈다
    assert caplog.records == []


async def test_checkpoints_are_cleared_without_yielding_to_new_analyses(
    client: httpx.AsyncClient,
    queue: AnalysisQueue,
    deps: AppDeps,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """확인과 지우기 사이에 루프가 새 분석 제출·시작을 하지 못하게 루프 안에서 지운다."""
    import vater_core.analysis.queue as queue_module

    aid = row(deps, "failed")
    ran_in: list[int] = []
    monkeypatch.setattr(
        queue_module, "clear_checkpoints", lambda *a: ran_in.append(threading.get_ident())
    )
    assert (await client.delete(f"/analyses/{aid}")).status_code == 204
    assert ran_in == [threading.get_ident()]
