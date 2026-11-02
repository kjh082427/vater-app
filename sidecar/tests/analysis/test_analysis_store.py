import sqlite3

import pytest

from vater_core.analysis.models import EngineResult
from vater_core.analysis.store import AnalysisRepo
from vater_core.analysis.summary import DecisionSummary
from vater_core.analysis.symbols import resolve_target
from vater_core.api.errors import VaterError

MODELS = {"deep": {"provider": "google", "model": "gemini-3.8-flash"}}


def result(decision: str = "Hold") -> EngineResult:
    return EngineResult(
        summary=DecisionSummary(decision, ("첫 줄.", "둘째 줄."), None, "3-6 months"),  # type: ignore[arg-type]
        reports={"market_report": "차트 보고서", "final_trade_decision": "**Rating**: Hold"},
        timings={"analysts": 120.5, "portfolio": 30.0},
        tokens={"in": 1000, "out": 200},
    )


def test_lifecycle_queued_running_done(db: sqlite3.Connection) -> None:
    repo = AnalysisRepo(db)
    t = resolve_target(db, "KR", "005930")
    aid = repo.create(t, "2026-11-02", "cloud")
    a = repo.get(aid)
    assert (a.status, a.market, a.code, a.as_of, a.preset) == (
        "queued",
        "KR",
        "005930",
        "2026-11-02",
        "cloud",
    )
    repo.set_running(aid, MODELS)
    assert repo.get(aid).status == "running" and repo.get(aid).models == MODELS
    repo.finish(aid, result())
    done = repo.get(aid)
    assert done.status == "done" and done.decision == "Hold"
    assert done.summary == ["첫 줄.", "둘째 줄."]
    assert done.time_horizon == "3-6 months" and done.price_target is None
    assert done.reports == {
        "market_report": "차트 보고서",
        "final_trade_decision": "**Rating**: Hold",
    }
    assert done.timings == {"analysts": 120.5, "portfolio": 30.0}
    assert done.tokens == {"in": 1000, "out": 200}
    assert done.error is None and done.name == "삼성전자"


def test_fail_and_cancel(db: sqlite3.Connection) -> None:
    repo = AnalysisRepo(db)
    t = resolve_target(db, "US", "AAPL")
    a1 = repo.create(t, "2026-11-02", "mixed")
    repo.fail(a1, "LLM_UNREACHABLE", "클라우드 AI에 연결하지 못했습니다.", "다시 시도하세요.")
    failed = repo.get(a1)
    assert failed.status == "failed"
    assert failed.error == {
        "code": "LLM_UNREACHABLE",
        "message": "클라우드 AI에 연결하지 못했습니다.",
        "hint": "다시 시도하세요.",
    }
    a2 = repo.create(t, "2026-11-02", "mixed")
    repo.cancel(a2)
    assert repo.get(a2).status == "cancelled"


def test_get_unknown(db: sqlite3.Connection) -> None:
    with pytest.raises(VaterError) as e:
        AnalysisRepo(db).get(999)
    assert (e.value.code, e.value.status) == ("ANALYSIS_NOT_FOUND", 404)


def test_list_newest_first_and_filter(db: sqlite3.Connection) -> None:
    repo = AnalysisRepo(db)
    kr, us = resolve_target(db, "KR", "005930"), resolve_target(db, "US", "AAPL")
    ids = [repo.create(kr, "2026-11-02", "cloud"), repo.create(us, "2026-11-02", "cloud")]
    ids.append(repo.create(kr, "2026-11-03", "cloud"))
    assert [a.id for a in repo.list()] == [ids[2], ids[1], ids[0]]
    assert [a.id for a in repo.list(market="KR", code="005930")] == [ids[2], ids[0]]
    assert [a.id for a in repo.list(limit=1)] == [ids[2]]


def test_previous_done_skips_unfinished(db: sqlite3.Connection) -> None:
    repo = AnalysisRepo(db)
    t = resolve_target(db, "KR", "005930")
    first = repo.create(t, "2026-10-30", "cloud")
    repo.finish(first, result("Buy"))
    failed = repo.create(t, "2026-10-31", "cloud")
    repo.fail(failed, "ANALYSIS_FAILED", "실패", None)
    latest = repo.create(t, "2026-11-02", "cloud")
    repo.finish(latest, result("Sell"))
    prev = repo.previous_done("KR", "005930", before_id=latest)
    assert prev is not None and prev.id == first and prev.decision == "Buy"
    assert repo.previous_done("KR", "005930", before_id=first) is None


def test_recover_interrupted(db: sqlite3.Connection) -> None:
    repo = AnalysisRepo(db)
    t = resolve_target(db, "KR", "005930")
    queued = repo.create(t, "2026-11-02", "cloud")
    running = repo.create(t, "2026-11-02", "cloud")
    repo.set_running(running, MODELS)
    done = repo.create(t, "2026-11-02", "cloud")
    repo.finish(done, result())
    assert repo.recover_interrupted() == 2
    for aid in (queued, running):
        a = repo.get(aid)
        assert a.status == "failed" and a.error is not None
        assert a.error["code"] == "ANALYSIS_INTERRUPTED"
    assert repo.get(done).status == "done"
