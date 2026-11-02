"""분석 엔진 경계 (스펙 5장). TradingAgents는 이 파일과 `kis_vendor.py`에서만 import한다.

실행 방식은 검증 실험에서 동작을 확인한 그대로다(`spikes/tradingagents-local-llm/run_spike.py`):
- 체크포인트(S5): `checkpoint_scope` + `checkpoint_input`.
  같은 종목·기준일·설정이면 끝난 단계를 건너뛴다.
- 진행 스트리밍(S6): `graph.stream(subgraphs=True, stream_mode=["updates", "values"])`.
- 결정(S4): TradingAgents의 `run_rating`.

엔진은 워커 스레드에서 돈다(동기). 취소는 노드 경계에서만 반영된다(LLM 호출 도중에는 끊지 않는다).
"""

import copy
import os
import threading
import time
from collections.abc import Callable, Iterable, Iterator, Mapping
from contextlib import contextmanager, nullcontext
from dataclasses import dataclass, field
from typing import Any, Protocol

from vater_core.analysis.kis_vendor import (
    KIS_TOOLS,
    VENDOR,
    KisBridge,
    install_kis_vendor,
    kis_session,
)
from vater_core.analysis.models import EngineJob, EngineResult, Progress
from vater_core.analysis.summary import summarize
from vater_core.analysis.symbols import analysts_for

REPORT_KEYS = (
    "market_report",
    "sentiment_report",
    "news_report",
    "fundamentals_report",
    "investment_plan",
    "trader_investment_plan",
    "final_trade_decision",
)
LLM_MAX_RETRIES = 2  # 스펙 8장: 클라우드 LLM 실패는 2회 재시도
_STAGES = {
    "Market Analyst": "analysts",
    "Sentiment Analyst": "analysts",
    "News Analyst": "analysts",
    "Fundamentals Analyst": "analysts",
    "Bull Researcher": "research",
    "Bear Researcher": "research",
    "Research Manager": "research",
    "Trader": "trader",
    "Aggressive Analyst": "risk",
    "Conservative Analyst": "risk",
    "Neutral Analyst": "risk",
    "Portfolio Manager": "portfolio",
}

Step = tuple[tuple[str, ...], str, Any]


class Cancelled(Exception):  # 취소는 오류가 아니라 결과다
    pass


class AnalysisEngine(Protocol):
    def run(
        self,
        job: EngineJob,
        on_progress: Callable[[Progress], None],
        cancel: threading.Event,
        kis: KisBridge | None,
    ) -> EngineResult: ...


def stage_of(node: str, namespace: str) -> str:
    if namespace:  # 애널리스트는 각자 서브그래프에서 돈다 ("Market Analyst:<uuid>")
        return "analysts"
    return _STAGES.get(node, "other")


@dataclass
class StreamOutcome:
    final: dict[str, Any] = field(default_factory=dict)
    timings: dict[str, float] = field(default_factory=dict)


def consume(
    steps: Iterable[Step],
    on_progress: Callable[[Progress], None],
    cancel: threading.Event,
    clock: Callable[[], float] = time.monotonic,
) -> StreamOutcome:
    """노드 이벤트를 진행 상황으로 바꾸고, 최상위 `values`로 최종 상태를 모은다.

    단계별 시간은 "직전 이벤트부터 이 이벤트까지"를 이 이벤트의 단계에 더한다(합계 = 전체 시간).
    """
    out = StreamOutcome()
    t0 = prev = clock()
    for namespace, mode, chunk in steps:
        if mode == "values":
            if not namespace and isinstance(chunk, dict):
                out.final.update(chunk)
            continue
        if mode != "updates" or not isinstance(chunk, dict):
            continue
        now = clock()
        ns = "/".join(namespace)
        for i, node in enumerate(chunk):
            stage = stage_of(node, ns)
            if i == 0:
                out.timings[stage] = round(out.timings.get(stage, 0.0) + now - prev, 1)
            label = f"{ns.split(':')[0]}/{node}" if ns else node
            on_progress(Progress(stage=stage, node=label, elapsed_sec=round(now - t0, 1)))
            if cancel.is_set():
                raise Cancelled
        prev = now
    return out


def result_from_final(
    final: Mapping[str, Any], rating: str | None, timings: dict[str, float], tokens: dict[str, int]
) -> EngineResult:
    reports = {k: str(final.get(k) or "") for k in REPORT_KEYS}
    return EngineResult(
        summary=summarize(reports["final_trade_decision"], rating),
        reports=reports,
        timings=timings,
        tokens=tokens,
    )


def build_config(job: EngineJob) -> dict[str, Any]:
    from tradingagents.default_config import DEFAULT_CONFIG

    cfg: dict[str, Any] = copy.deepcopy(DEFAULT_CONFIG)
    cfg.update(job.run.overrides)
    cfg.update(
        results_dir=str(job.paths.results_dir),
        data_cache_dir=str(job.paths.data_cache_dir),
        memory_log_path=str(job.paths.memory_log_path),
        checkpoint_enabled=True,
        llm_max_retries=LLM_MAX_RETRIES,
    )
    if job.target.domestic:
        cfg["tool_vendors"] = {**cfg.get("tool_vendors", {}), **dict.fromkeys(KIS_TOOLS, VENDOR)}
    return cfg


@contextmanager
def scoped_env(env: Mapping[str, str]) -> Iterator[None]:
    """API 키를 분석 실행 동안만 환경변수에 둔다. 끝나면(오류여도) 원래대로 돌린다."""
    saved = {k: os.environ.get(k) for k in env}
    os.environ.update(env)
    try:
        yield
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


class _TokenCounter:
    """LangChain 콜백. 애널리스트가 병렬로 돌아서 잠금을 쓴다."""

    def __init__(self) -> None:
        from langchain_core.callbacks import BaseCallbackHandler

        counter = self

        class Handler(BaseCallbackHandler):
            def on_llm_end(self, response: Any, **kwargs: Any) -> None:
                counter.add(response)

        self.handler = Handler()
        self._lock = threading.Lock()
        self.tokens = {"in": 0, "out": 0}

    def add(self, response: Any) -> None:
        for gens in getattr(response, "generations", []):
            for g in gens:
                usage = getattr(getattr(g, "message", None), "usage_metadata", None) or {}
                with self._lock:
                    self.tokens["in"] += int(usage.get("input_tokens", 0) or 0)
                    self.tokens["out"] += int(usage.get("output_tokens", 0) or 0)


class TradingAgentsEngine:
    def run(
        self,
        job: EngineJob,
        on_progress: Callable[[Progress], None],
        cancel: threading.Event,
        kis: KisBridge | None,
    ) -> EngineResult:
        from tradingagents.agents.rating import run_rating
        from tradingagents.dataflows.config import run_config_context
        from tradingagents.graph.trading_graph import TradingAgentsGraph

        install_kis_vendor()
        config = build_config(job)
        for p in (
            job.paths.results_dir,
            job.paths.data_cache_dir,
            job.paths.memory_log_path.parent,
        ):
            p.mkdir(parents=True, exist_ok=True)
        ticker, day = job.target.ticker, job.as_of.isoformat()
        tokens = _TokenCounter()
        session = kis_session(kis) if kis is not None else nullcontext()
        # LLM 클라이언트가 만들어질 때 키를 읽으므로 그래프 생성부터 감싼다.
        with scoped_env(job.run.env), session:
            ta = TradingAgentsGraph(
                selected_analysts=analysts_for(job.target),
                config=config,
                callbacks=[tokens.handler],
            )
            with ta.checkpoint_scope(ticker, day) as thread_id:
                init = ta.create_run_state(ticker, day)
                args = ta.propagator.get_graph_args()
                args["stream_mode"] = ["updates", "values"]
                if thread_id is not None:
                    args.setdefault("config", {}).setdefault("configurable", {})["thread_id"] = (
                        thread_id
                    )
                ctx = run_config_context(ta.config)
                stream = ctx.run(ta.graph.stream, ta.checkpoint_input(init), subgraphs=True, **args)

                def steps() -> Iterator[Step]:
                    while (step := ctx.run(next, stream, None)) is not None:
                        yield step

                try:
                    outcome = consume(steps(), on_progress, cancel)
                finally:
                    ctx.run(stream.close)
            ta.clear_checkpoint_on_success(ticker, day)
        return result_from_final(
            outcome.final, run_rating(outcome.final), outcome.timings, tokens.tokens
        )
