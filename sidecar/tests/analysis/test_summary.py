from pathlib import Path

from vater_core.analysis.summary import DECISION_KO, decision_ko, normalize_decision, summarize

FIXTURE = Path(__file__).parent / "fixtures" / "final_decision_cloud.md"


def test_summarize_cloud_sample() -> None:
    """검증 실험의 실제 결정문(AAPL, Gemini, 한국어 출력)."""
    s = summarize(FIXTURE.read_text(encoding="utf-8"), rating="Hold")
    assert s.decision == "Hold"
    assert len(s.lines) == 3
    assert s.lines[0].startswith("AAPL에 대해 기존 포지션을 유지하고")
    # 숫자 안의 마침표(344.04)에서는 문장을 자르지 않는다
    assert s.lines[1].startswith("단기적으로 10일 EMA(344.04)")
    assert s.price_target is None  # "not provided"
    assert s.time_horizon == "3-6 months"


def test_summary_falls_back_to_thesis() -> None:
    text = "**Rating**: Sell\n\n**Investment Thesis**: 첫째 이유입니다. 둘째 이유입니다."
    s = summarize(text, rating="Sell")
    assert s.lines == ("첫째 이유입니다.", "둘째 이유입니다.")


def test_summary_without_sections_uses_text() -> None:
    s = summarize("결정 근거가 한 문단으로만 왔습니다. 다음 문장입니다. 셋째. 넷째.", rating=None)
    assert s.decision == "REVIEW"
    assert s.lines == ("결정 근거가 한 문단으로만 왔습니다.", "다음 문장입니다.", "셋째.")


def test_empty_decision_text() -> None:
    s = summarize("", rating="Buy")
    assert s.decision == "Buy" and s.lines == () and s.time_horizon is None


def test_normalize_decision() -> None:
    assert normalize_decision("overweight") == "Overweight"
    assert normalize_decision("BUY") == "Buy"
    assert normalize_decision("REVIEW") == "REVIEW"
    assert normalize_decision("strong buy") == "REVIEW"
    assert normalize_decision(None) == "REVIEW"


def test_korean_labels_cover_all_decisions() -> None:
    assert DECISION_KO == {
        "Buy": "매수",
        "Overweight": "비중확대",
        "Hold": "보유",
        "Underweight": "비중축소",
        "Sell": "매도",
        "REVIEW": "검토 필요",
    }
    assert decision_ko("Hold") == "보유"
    assert decision_ko(None) is None and decision_ko("strong buy") is None
