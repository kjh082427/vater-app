# SPIKE: throwaway code, not part of the app
"""S2: LLM 없이 TradingAgents 데이터 함수를 직접 불러 종목별 데이터 품질을 기록한다.

사용: uv run python inspect_data.py <ticker> [<as_of_date YYYY-MM-DD>]
출력: runs/data-<ticker>.json
"""

import json
import sys
from datetime import date, timedelta
from pathlib import Path

from tradingagents.dataflows.router import route_to_vendor

RUNS = Path(__file__).parent / "runs"
UNAVAILABLE_MARKERS = ("NO_DATA_AVAILABLE", "DATA_UNAVAILABLE")


def probe(name: str, method: str, *args: object) -> dict[str, object]:
    try:
        out = route_to_vendor(method, *args)
        text = out if isinstance(out, str) else str(out)
        empty = (not text.strip()) or text.startswith(UNAVAILABLE_MARKERS)
        return {"kind": name, "chars": len(text), "empty": empty, "error": None, "sample": text[:300]}
    except Exception as e:  # noqa: BLE001
        return {"kind": name, "chars": 0, "empty": True, "error": f"{type(e).__name__}: {e}"[:300], "sample": ""}


def main() -> int:
    ticker = sys.argv[1]
    as_of = sys.argv[2] if len(sys.argv) > 2 else (date.today() - timedelta(days=1)).isoformat()
    start = (date.fromisoformat(as_of) - timedelta(days=365)).isoformat()
    news_start = (date.fromisoformat(as_of) - timedelta(days=7)).isoformat()
    results = [
        probe("price_1y", "get_stock_data", ticker, start, as_of),
        probe("indicator_rsi", "get_indicators", ticker, "rsi", as_of, 30),
        probe("indicator_macd", "get_indicators", ticker, "macd", as_of, 30),
        probe("fundamentals", "get_fundamentals", ticker, as_of),
        probe("balance_sheet", "get_balance_sheet", ticker, "quarterly", as_of),
        probe("income_statement", "get_income_statement", ticker, "quarterly", as_of),
        probe("news_7d", "get_news", ticker, news_start, as_of),
        probe("insider", "get_insider_transactions", ticker, as_of),
    ]
    RUNS.mkdir(exist_ok=True)
    out = RUNS / f"data-{ticker}.json"
    out.write_text(json.dumps({"ticker": ticker, "as_of": as_of, "results": results}, ensure_ascii=False, indent=2))
    for r in results:
        mark = "❌" if r["error"] else ("⚠️" if r["empty"] else "✅")
        print(f"{mark} {ticker:<11} {r['kind']:<17} chars={r['chars']:<7} {r['error'] or ''}")
        if not str(r["kind"]).startswith(("price", "indicator")):
            snippet = str(r["sample"]).replace("\n", " | ")[:200]
            print(f"      └ {snippet}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
