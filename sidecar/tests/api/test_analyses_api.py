"""분석 API. 엔진은 가짜, 큐는 실제(AnalysisQueue)를 쓴다."""

import asyncio
import threading
from collections.abc import AsyncIterator
from datetime import date
from typing import Any

import httpx
import pytest

from vater_core.analysis.engine import Cancelled
from vater_core.analysis.models import EngineResult, Progress
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
    assert body["models"]["deep"] == {"provider": "google", "model": "gemini-3.8-flash"}
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
