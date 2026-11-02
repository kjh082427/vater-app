"""최종 결정문에서 화면에 먼저 보여줄 것(결정, 3줄 요약, 목표가, 기간)을 뽑는다.

TradingAgents의 Portfolio Manager는 `**Rating**:`, `**Executive Summary**:`,
`**Investment Thesis**:`, `**Price Target**:`, `**Time Horizon**:` 항목으로 쓴다(검증 실험 S4).
등급 자체는 엔진이 TradingAgents의 `run_rating`으로 읽어서 넘긴다(같은 규칙을 다시 만들지 않는다).
"""

import re
from dataclasses import dataclass
from typing import Literal

Decision = Literal["Buy", "Overweight", "Hold", "Underweight", "Sell", "REVIEW"]
DECISIONS: tuple[Decision, ...] = ("Buy", "Overweight", "Hold", "Underweight", "Sell", "REVIEW")
DECISION_KO: dict[Decision, str] = {
    "Buy": "매수",
    "Overweight": "비중확대",
    "Hold": "보유",
    "Underweight": "비중축소",
    "Sell": "매도",
    "REVIEW": "검토 필요",
}
MAX_LINES = 3

_SECTION = re.compile(r"^\s*[-*]?\s*\*\*(?P<label>[^*]+)\*\*\s*:\s*(?P<body>.*)$")
_SENTENCE_END = re.compile(r"(?<=[.!?。])\s+")


@dataclass(frozen=True)
class DecisionSummary:
    decision: Decision
    lines: tuple[str, ...]
    price_target: str | None
    time_horizon: str | None


def normalize_decision(rating: str | None) -> Decision:
    if rating is None:
        return "REVIEW"
    for d in DECISIONS:
        if rating.strip().lower() == d.lower():
            return d
    return "REVIEW"


def _sections(text: str) -> dict[str, str]:
    """`**Label**: 본문` 항목을 모은다. 본문이 여러 줄이면 다음 항목 전까지 잇는다."""
    out: dict[str, str] = {}
    current: str | None = None
    for line in text.splitlines():
        m = _SECTION.match(line)
        if m:
            current = m.group("label").strip().lower()
            out[current] = m.group("body").strip()
        elif current is not None and line.strip():
            out[current] = f"{out[current]} {line.strip()}".strip()
    return out


def _sentences(text: str) -> tuple[str, ...]:
    parts = [p.strip() for p in _SENTENCE_END.split(text.strip()) if p.strip()]
    return tuple(parts[:MAX_LINES])


def _optional(value: str | None) -> str | None:
    if value is None or not value.strip() or value.strip().lower() in ("not provided", "n/a"):
        return None
    return value.strip()


def summarize(final_trade_decision: str, rating: str | None) -> DecisionSummary:
    sections = _sections(final_trade_decision)
    body = sections.get("executive summary") or sections.get("investment thesis")
    if body is None:  # 항목 형식이 아니면 본문 앞부분을 쓴다
        body = " ".join(
            line.strip()
            for line in final_trade_decision.splitlines()
            if line.strip() and not _SECTION.match(line)
        )
    return DecisionSummary(
        decision=normalize_decision(rating),
        lines=_sentences(body),
        price_target=_optional(sections.get("price target")),
        time_horizon=_optional(sections.get("time horizon")),
    )


def decision_ko(decision: str | None) -> str | None:
    for d, ko in DECISION_KO.items():
        if d == decision:
            return ko
    return None
