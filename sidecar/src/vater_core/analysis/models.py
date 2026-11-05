"""분석 엔진·작업 큐·저장소가 함께 쓰는 데이터 형식."""

from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

from vater_core.analysis.summary import DecisionSummary
from vater_core.analysis.symbols import Target
from vater_core.llm.presets import LlmRun


@dataclass(frozen=True)
class TaPaths:
    """TradingAgents가 파일을 쓰는 곳. 모두 앱 데이터 폴더 아래에 둔다."""

    results_dir: Path
    data_cache_dir: Path  # 체크포인트: data_cache_dir/checkpoints/<티커>.db (검증 실험 S5)

    @classmethod
    def under(cls, data_dir: Path) -> "TaPaths":
        base = data_dir / "cache" / "tradingagents"
        return cls(base / "logs", base / "cache")


@dataclass(frozen=True)
class EngineJob:
    id: int
    target: Target
    as_of: date
    run: LlmRun
    paths: TaPaths


@dataclass(frozen=True)
class Progress:
    stage: str  # analysts | research | trader | risk | portfolio | other
    node: str
    elapsed_sec: float
    wait: dict[str, Any] | None = None  # 기다리는 중: {reason: busy|rate, message, seconds}


@dataclass(frozen=True)
class EngineResult:
    summary: DecisionSummary
    reports: dict[str, str]
    timings: dict[str, float]  # 단계별 소요 시간(초)
    tokens: dict[str, int]  # {"in": 입력 토큰, "out": 출력 토큰}
    fallbacks: dict[str, list[str]] = field(default_factory=dict)  # 단계별로 대신 답한 모델
