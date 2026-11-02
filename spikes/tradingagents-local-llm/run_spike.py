# SPIKE: throwaway code, not part of the app
"""TradingAgents 1회 실행 측정 (S1, S3, S4, S6, S5, S8).

사용: uv run python run_spike.py --ticker AAPL --preset local-4b [--date 2026-11-02] [--checkpoint] [--lang Korean]
출력: runs/run-<ts>-<ticker>-<preset>.json (+ 같은 이름의 -reports.md)
"""

import argparse
import json
import re
import signal
import sys
import time
import traceback
from datetime import date, timedelta
from typing import Any

from langchain_core.callbacks import BaseCallbackHandler

import presets
from presets import RUNS, build_config, default_analysts, load_keys

REPORT_KEYS = ("market_report", "sentiment_report", "news_report", "fundamentals_report",
               "investment_plan", "trader_investment_plan", "final_trade_decision")
NO_DATA = ("NO_DATA_AVAILABLE", "DATA_UNAVAILABLE")
HANGUL = re.compile(r"[가-힣]")
LETTER = re.compile(r"[A-Za-z가-힣]")


class Stats(BaseCallbackHandler):
    """LLM 호출 수, 토큰 수, 도구 호출과 도구 오류를 센다."""

    def __init__(self) -> None:
        self.llm_calls = 0
        self.tokens_in = 0
        self.tokens_out = 0
        self.tool_calls = 0
        self.tool_errors: list[str] = []

    def on_llm_end(self, response: Any, **kwargs: Any) -> None:
        self.llm_calls += 1
        for gens in response.generations:
            for g in gens:
                usage = getattr(getattr(g, "message", None), "usage_metadata", None) or {}
                self.tokens_in += int(usage.get("input_tokens", 0) or 0)
                self.tokens_out += int(usage.get("output_tokens", 0) or 0)

    def on_tool_start(self, serialized: Any, input_str: str, **kwargs: Any) -> None:
        self.tool_calls += 1

    def on_tool_error(self, error: BaseException, **kwargs: Any) -> None:
        self.tool_errors.append(f"{type(error).__name__}: {error}"[:300])


def last_weekday_before(d: date) -> date:
    d -= timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def hangul_ratio(text: str) -> float:
    letters = LETTER.findall(text)
    return round(len(HANGUL.findall(text)) / len(letters), 3) if letters else 0.0


def on_timeout(signum: int, frame: Any) -> None:
    raise TimeoutError("run exceeded time limit")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ticker", required=True)
    ap.add_argument("--preset", required=True, choices=presets.PRESETS)
    ap.add_argument("--date", default=last_weekday_before(date.today()).isoformat())
    ap.add_argument("--lang", default="Korean")
    ap.add_argument("--checkpoint", action="store_true")
    ap.add_argument("--timeout-min", type=int, default=60)
    a = ap.parse_args()

    keys = load_keys()  # 키 값은 출력하지 않는다
    from tradingagents.agents.rating import run_rating
    from tradingagents.dataflows.config import run_config_context
    from tradingagents.graph.trading_graph import TradingAgentsGraph

    cfg = build_config(a.preset, a.lang, a.checkpoint)
    stats = Stats()
    analysts = default_analysts(a.ticker)
    rec: dict[str, Any] = {
        "preset": a.preset, "ticker": a.ticker, "date": a.date, "lang": a.lang, "checkpoint": a.checkpoint,
        "analysts": list(analysts), "keys_loaded": keys,
        "models": {"deep": [cfg.get("deep_think_provider") or cfg["llm_provider"], cfg["deep_think_llm"]],
                   "quick": [cfg.get("quick_think_provider") or cfg["llm_provider"], cfg["quick_think_llm"]]},
        "node_events": [], "exceptions": [], "status": "running",
    }
    t0 = time.monotonic()
    final: dict[str, Any] = {}
    signal.signal(signal.SIGALRM, on_timeout)
    signal.alarm(a.timeout_min * 60)
    ta = None
    try:
        ta = TradingAgentsGraph(selected_analysts=analysts, config=cfg, callbacks=[stats])
        with ta.checkpoint_scope(a.ticker, a.date) as tid:
            rec["checkpoint_thread"] = tid
            init = ta.create_run_state(a.ticker, a.date)
            args = ta.propagator.get_graph_args()
            args["stream_mode"] = ["updates", "values"]
            if tid is not None:
                args.setdefault("config", {}).setdefault("configurable", {})["thread_id"] = tid
            ctx = run_config_context(ta.config)
            stream = ctx.run(ta.graph.stream, ta.checkpoint_input(init), subgraphs=True, **args)
            try:
                while (step := ctx.run(next, stream, None)) is not None:
                    namespace, mode, chunk = step
                    if mode == "updates" and isinstance(chunk, dict):
                        for node in chunk:
                            ev = {"node": node, "ns": "/".join(namespace) if namespace else "", "t": round(time.monotonic() - t0, 1)}
                            rec["node_events"].append(ev)
                            print(f"[{ev['t']:>7}s] {ev['ns'] + ' > ' if ev['ns'] else ''}{node}", flush=True)
                    elif mode == "values" and not namespace and isinstance(chunk, dict):
                        final.update(chunk)
            finally:
                ctx.run(stream.close)
        ta.clear_checkpoint_on_success(a.ticker, a.date)
        rec["status"] = "done"
    except TimeoutError as e:
        rec["status"] = "timeout"
        rec["exceptions"].append(str(e))
    except BaseException as e:  # noqa: BLE001  (Ctrl+C/kill 포함, 체크포인트 실험용)
        rec["status"] = "failed" if not isinstance(e, KeyboardInterrupt) else "interrupted"
        rec["exceptions"].append("".join(traceback.format_exception_only(type(e), e)).strip()[:1500])
    finally:
        signal.alarm(0)

    rec["wall_sec"] = round(time.monotonic() - t0, 1)
    reports = {k: (final.get(k) or "") for k in REPORT_KEYS}
    rec["report_lengths"] = {k: len(v) for k, v in reports.items()}
    rec["empty_reports"] = [k for k, v in reports.items() if len(v.strip()) < 50]
    rec["no_data_mentions"] = [k for k, v in reports.items() if any(m in v for m in NO_DATA)]
    rec["decision_raw"] = reports["final_trade_decision"][:3000]
    rec["decision_parsed"] = run_rating(final) if final.get("final_trade_decision") else None
    rec["output_language_guess"] = {k: hangul_ratio(v) for k, v in reports.items() if v}
    rec["llm_calls"] = stats.llm_calls
    rec["tokens"] = {"in": stats.tokens_in, "out": stats.tokens_out} if stats.llm_calls else None
    rec["tool_calls"] = stats.tool_calls
    rec["tool_errors"] = stats.tool_errors[:20]

    RUNS.mkdir(exist_ok=True)
    stem = f"run-{time.strftime('%Y%m%d-%H%M%S')}-{a.ticker}-{a.preset}{'-ckpt' if a.checkpoint else ''}"
    (RUNS / f"{stem}.json").write_text(json.dumps(rec, ensure_ascii=False, indent=2))
    (RUNS / f"{stem}-reports.md").write_text("\n\n".join(f"# {k}\n\n{v}" for k, v in reports.items()))
    print(json.dumps({k: rec[k] for k in ("status", "wall_sec", "decision_parsed", "llm_calls", "tokens",
                                           "tool_calls", "empty_reports", "no_data_mentions")}, ensure_ascii=False))
    print("saved:", RUNS / f"{stem}.json")
    return 0 if rec["status"] == "done" else 1


if __name__ == "__main__":
    sys.exit(main())
