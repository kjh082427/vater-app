"""분석 엔진. TradingAgents의 LLM은 부르지 않는다(실제 실행은 tests/analysis_live)."""

import json
import os
import sqlite3
import threading
from collections.abc import Iterator
from datetime import date
from pathlib import Path
from typing import Any

import pytest

from vater_core.analysis.engine import (
    REPORT_KEYS,
    Cancelled,
    build_config,
    consume,
    result_from_final,
    scoped_env,
    stage_of,
)
from vater_core.analysis.kis_vendor import KIS_TOOLS
from vater_core.analysis.models import EngineJob, Progress, TaPaths
from vater_core.analysis.symbols import resolve_target
from vater_core.llm.presets import LlmRun, TierChoice

FIXTURE = Path(__file__).parent / "fixtures" / "final_decision_cloud.md"


def job(
    db: sqlite3.Connection, tmp_path: Path, market: str = "KR", code: str = "005930"
) -> EngineJob:
    run = LlmRun(
        preset="cloud",
        deep=TierChoice("google", "gemini-3.8-flash", None),
        quick=TierChoice("google", "gemini-3.5-flash-lite", None),
        overrides={
            "llm_provider": "google",
            "deep_think_llm": "gemini-3.8-flash",
            "quick_think_llm": "gemini-3.5-flash-lite",
            "backend_url": None,
            "output_language": "Korean",
            "max_debate_rounds": 1,
            "max_risk_discuss_rounds": 1,
        },
        env={"GOOGLE_API_KEY": "g-secret-123"},
    )
    return EngineJob(
        1, resolve_target(db, market, code), date(2026, 11, 2), run, TaPaths.under(tmp_path)
    )


@pytest.mark.parametrize(
    ("node", "ns", "stage"),
    [
        ("agent", "Market Analyst:1f2e", "analysts"),
        ("tools", "News Analyst:9a", "analysts"),
        ("Market Analyst", "", "analysts"),
        ("Sentiment Analyst", "", "analysts"),
        ("Fundamentals Analyst", "", "analysts"),
        ("Bull Researcher", "", "research"),
        ("Bear Researcher", "", "research"),
        ("Research Manager", "", "research"),
        ("Trader", "", "trader"),
        ("Aggressive Analyst", "", "risk"),
        ("Conservative Analyst", "", "risk"),
        ("Neutral Analyst", "", "risk"),
        ("Portfolio Manager", "", "portfolio"),
        ("Memory Log", "", "other"),
    ],
)
def test_stage_of(node: str, ns: str, stage: str) -> None:
    assert stage_of(node, ns) == stage


def test_build_config_domestic_uses_kis(db: sqlite3.Connection, tmp_path: Path) -> None:
    cfg = build_config(job(db, tmp_path))
    assert cfg["tool_vendors"] == dict.fromkeys(KIS_TOOLS, "kis")
    assert cfg["checkpoint_enabled"] is True and cfg["llm_max_retries"] == 2
    assert cfg["llm_provider"] == "google" and cfg["output_language"] == "Korean"
    assert cfg["data_cache_dir"] == str(tmp_path / "cache" / "tradingagents" / "cache")
    assert cfg["memory_log_path"].startswith(str(tmp_path))
    assert cfg["results_dir"].startswith(str(tmp_path))


def test_build_config_us_keeps_default_vendors(db: sqlite3.Connection, tmp_path: Path) -> None:
    from tradingagents.default_config import DEFAULT_CONFIG

    cfg = build_config(job(db, tmp_path, "US", "AAPL"))
    assert cfg["tool_vendors"] == DEFAULT_CONFIG.get("tool_vendors", {})


def test_build_config_has_no_secrets(db: sqlite3.Connection, tmp_path: Path) -> None:
    text = json.dumps(build_config(job(db, tmp_path)), default=str)
    assert "g-secret-123" not in text


def test_scoped_env_restores_on_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "before")
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    with pytest.raises(RuntimeError), scoped_env({"OPENAI_API_KEY": "x", "GOOGLE_API_KEY": "y"}):
        assert os.environ["GOOGLE_API_KEY"] == "y"
        raise RuntimeError("boom")
    assert os.environ["OPENAI_API_KEY"] == "before"
    assert "GOOGLE_API_KEY" not in os.environ


class Clock:
    def __init__(self, times: list[float]) -> None:
        self._times = iter(times)

    def __call__(self) -> float:
        return next(self._times)


def steps() -> Iterator[tuple[tuple[str, ...], str, Any]]:
    yield (), "updates", {"Memory Log": {}}
    yield ("Market Analyst:1",), "updates", {"agent": {}}
    yield ("Market Analyst:1",), "updates", {"tools": {}}
    yield (), "updates", {"Market Analyst": {}}
    yield (), "values", {"market_report": "차트"}
    yield (), "updates", {"Bull Researcher": {}}
    yield (), "updates", {"Portfolio Manager": {}}
    yield (), "values", {"market_report": "차트", "final_trade_decision": "**Rating**: Hold"}
    yield ("Market Analyst:1",), "values", {"ignored": "subgraph values"}


def test_consume_reports_progress_and_timings() -> None:
    seen: list[Progress] = []
    # 시작 0초, 이후 updates 이벤트마다 시계를 읽는다
    clock = Clock([0.0, 1.0, 11.0, 31.0, 41.0, 101.0, 161.0])
    outcome = consume(steps(), seen.append, threading.Event(), clock)
    assert [(p.stage, p.node) for p in seen] == [
        ("other", "Memory Log"),
        ("analysts", "Market Analyst/agent"),
        ("analysts", "Market Analyst/tools"),
        ("analysts", "Market Analyst"),
        ("research", "Bull Researcher"),
        ("portfolio", "Portfolio Manager"),
    ]
    assert seen[-1].elapsed_sec == 161.0
    assert outcome.final == {"market_report": "차트", "final_trade_decision": "**Rating**: Hold"}
    # 각 이벤트까지 걸린 시간을 그 단계에 더한다 → 합계 = 전체 시간
    assert outcome.timings == {"other": 1.0, "analysts": 40.0, "research": 60.0, "portfolio": 60.0}


def test_consume_cancels_between_nodes() -> None:
    cancel = threading.Event()
    seen: list[Progress] = []

    def on_progress(p: Progress) -> None:
        seen.append(p)
        if len(seen) == 2:
            cancel.set()

    with pytest.raises(Cancelled):
        consume(steps(), on_progress, cancel, Clock([float(i) for i in range(20)]))
    assert len(seen) == 2  # 취소 뒤의 이벤트는 처리하지 않는다


def test_result_from_final_state() -> None:
    final = {k: f"{k} 본문" for k in REPORT_KEYS}
    final["final_trade_decision"] = FIXTURE.read_text(encoding="utf-8")
    r = result_from_final(final, "Hold", {"analysts": 10.0}, {"in": 5, "out": 3})
    assert r.summary.decision == "Hold" and len(r.summary.lines) == 3
    assert set(r.reports) == set(REPORT_KEYS)
    assert r.timings == {"analysts": 10.0} and r.tokens == {"in": 5, "out": 3}


def test_result_with_missing_reports() -> None:
    final = {"final_trade_decision": "결정 근거만 있는 문단입니다."}
    r = result_from_final(final, None, {}, {"in": 0, "out": 0})
    assert r.summary.decision == "REVIEW"
    assert r.reports["market_report"] == ""


def test_result_without_decision_is_failure() -> None:
    """리뷰 Important #4: 끝난 체크포인트를 이어 받아 빈 상태가 오면 '완료'로 저장하지 않는다."""
    from vater_core.api.errors import VaterError

    with pytest.raises(VaterError) as e:
        result_from_final({}, None, {}, {"in": 0, "out": 0})
    assert e.value.code == "ANALYSIS_INCOMPLETE"
    assert "처음부터" in (e.value.hint or "")


def test_cancel_on_final_node_still_completes() -> None:
    """리뷰 Important #4: Portfolio Manager가 끝난 뒤에 온 취소는 결과를 버리지 않는다."""
    cancel = threading.Event()

    def on_progress(p: Progress) -> None:
        if p.node == "Portfolio Manager":
            cancel.set()  # 마지막 노드가 끝난 순간에 사용자가 취소를 눌렀다

    outcome = consume(steps(), on_progress, cancel, Clock([float(i) for i in range(20)]))
    assert outcome.final["final_trade_decision"] == "**Rating**: Hold"


def test_engine_checks_cancel_before_building_graph(db: sqlite3.Connection, tmp_path: Path) -> None:
    """리뷰 Important #3: 이미 취소됐으면 LLM 클라이언트·그래프를 만들지 않는다."""
    from vater_core.analysis.engine import TradingAgentsEngine

    cancel = threading.Event()
    cancel.set()
    with pytest.raises(Cancelled):
        TradingAgentsEngine().run(job(db, tmp_path), lambda p: None, cancel, None)
    assert not (tmp_path / "cache").exists()  # 아무것도 만들지 않았다
