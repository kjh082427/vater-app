"""국내 종목용 TradingAgents 데이터 공급자 `kis` (검증 실험 S2).

Yahoo에는 국내 재무·뉴스가 없고 일봉이 하루 늦어서, 국내 종목(.KS/.KQ)은 한투 API로 채운다.
TradingAgents의 `VENDOR_METHODS`에 등록하고, 분석 설정의 `tool_vendors`로 이 공급자를 고른다.

공급자 함수는 TradingAgents의 워커 스레드에서 불린다. 한투 클라이언트는 이벤트 루프의
비동기 클라이언트이므로 `KisBridge`가 `run_coroutine_threadsafe`로 루프에서 실행하고 기다린다.
한투 호출이 실패하면 `VendorUnavailableError`로 바꿔서, 분석은 "데이터 없음"으로 계속된다.
"""

import asyncio
import logging
import threading
from collections.abc import Awaitable, Callable, Iterator
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from typing import Any, Literal

import httpx
import pandas as pd
from stockstats import wrap
from tradingagents.dataflows import router
from tradingagents.dataflows.errors import NoMarketDataError, VendorUnavailableError

from vater_core.api.errors import VaterError
from vater_core.kis.client import KisApiError, KisClient
from vater_core.kis.config import Priority
from vater_core.kis.fundamentals import FinancialKind, as_markdown, financials, news_titles
from vater_core.kis.models import Bar
from vater_core.kis.quotes import domestic_daily

logger = logging.getLogger(__name__)

VENDOR = "kis"
PRIORITY = Priority.BRIEFING  # 알림 감시보다 낮게
INDICATOR_HISTORY_DAYS = 400  # 200일 이동평균을 계산할 만큼
KIS_TOOLS: tuple[str, ...] = (
    "get_stock_data",
    "get_indicators",
    "get_fundamentals",
    "get_balance_sheet",
    "get_income_statement",
    "get_cashflow",
    "get_news",
    "get_insider_transactions",
)
# TradingAgents yfinance 공급자와 같은 지표 이름 (설명은 짧게)
INDICATORS: dict[str, str] = {
    "close_50_sma": "50 SMA: medium-term trend.",
    "close_200_sma": "200 SMA: long-term trend benchmark.",
    "close_10_ema": "10 EMA: responsive short-term average.",
    "macd": "MACD: momentum via differences of EMAs.",
    "macds": "MACD Signal: EMA smoothing of the MACD line.",
    "macdh": "MACD Histogram: gap between MACD and its signal.",
    "rsi": "RSI: overbought (>70) / oversold (<30) momentum.",
    "boll": "Bollinger Middle: 20 SMA basis.",
    "boll_ub": "Bollinger Upper Band: 2 std above the middle.",
    "boll_lb": "Bollinger Lower Band: 2 std below the middle.",
    "atr": "ATR: average true range (volatility).",
    "vwma": "VWMA: volume-weighted moving average.",
    "mfi": "MFI: money flow index (>80 overbought, <20 oversold).",
}


class KisBridge:
    def __init__(
        self, client: KisClient, loop: asyncio.AbstractEventLoop, timeout: float = 30.0
    ) -> None:
        self.client = client
        self.loop = loop
        self.timeout = timeout

    def call[T](self, make: Callable[[KisClient], Awaitable[T]]) -> T:
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is self.loop:
            raise RuntimeError("KisBridge.call must run in a worker thread, not the event loop")

        async def run() -> T:
            return await make(self.client)

        future = asyncio.run_coroutine_threadsafe(run(), self.loop)
        try:
            return future.result(self.timeout)
        except TimeoutError:
            future.cancel()
            raise


_lock = threading.Lock()
_bridge: KisBridge | None = None


@contextmanager
def kis_session(bridge: KisBridge) -> Iterator[None]:
    """분석 1건이 도는 동안만 공급자가 쓸 브리지를 정한다. 분석은 한 번에 1건이다."""
    global _bridge
    with _lock:
        if _bridge is not None:
            raise RuntimeError("a KIS vendor session is already active")
        _bridge = bridge
    try:
        yield
    finally:
        with _lock:
            _bridge = None


def _call[T](make: Callable[[KisClient], Awaitable[T]]) -> T:
    with _lock:
        bridge = _bridge
    if bridge is None:
        raise RuntimeError("no KIS vendor session is active")
    try:
        return bridge.call(make)
    except (KisApiError, VaterError, httpx.HTTPError, TimeoutError) as e:
        logger.warning("KIS vendor call failed: %s", type(e).__name__)
        raise VendorUnavailableError(f"한국투자증권 조회 실패 ({type(e).__name__})") from e


def _code(symbol: str) -> str:
    code = symbol.split(".")[0].strip()
    if not (len(code) == 6 and code.isalnum()):
        raise NoMarketDataError(symbol, code, "국내 종목 코드(6자리)가 아닙니다")
    return code


def _day(text: str) -> date:
    return datetime.strptime(text, "%Y-%m-%d").date()


def _bars(symbol: str, start: date, end: date) -> list[Bar]:
    code = _code(symbol)
    bars = _call(lambda c: domestic_daily(c, code, start, end, PRIORITY))
    if not bars:
        raise NoMarketDataError(symbol, code, f"{start}~{end} 일봉이 없습니다")
    return bars


def get_stock_data(symbol: str, start_date: str, end_date: str) -> str:
    bars = _bars(symbol, _day(start_date), _day(end_date))
    lines = [
        f"# Stock data for {symbol} from {start_date} to {end_date}",
        f"# Total records: {len(bars)}",
        "# Source: 한국투자증권 (KRW, 수정주가)",
        "",
        "Date,Open,High,Low,Close,Volume",
    ]
    lines += [
        f"{b.day.isoformat()},{b.open:.1f},{b.high:.1f},{b.low:.1f},{b.close:.1f},{b.volume}"
        for b in bars
    ]
    return "\n".join(lines) + "\n"


def get_indicators(symbol: str, indicator: str, as_of_date: str, look_back_days: int) -> str:
    if indicator not in INDICATORS:
        raise ValueError(
            f"Indicator {indicator} is not supported. Please choose from: {list(INDICATORS)}"
        )
    as_of = _day(as_of_date)
    bars = _bars(symbol, as_of - timedelta(days=INDICATOR_HISTORY_DAYS), as_of)
    frame = pd.DataFrame(
        {
            "date": [b.day.isoformat() for b in bars],
            "open": [b.open for b in bars],
            "high": [b.high for b in bars],
            "low": [b.low for b in bars],
            "close": [b.close for b in bars],
            "volume": [b.volume for b in bars],
        }
    )
    series = wrap(frame)[indicator]
    values = {str(k)[:10]: v for k, v in series.items()}
    start = as_of - timedelta(days=look_back_days)
    out, day = [], as_of
    while day >= start:
        key = day.isoformat()
        if key not in values:
            out.append(f"{key}: N/A: Not a trading day (weekend or holiday)")
        elif pd.isna(values[key]):
            out.append(f"{key}: N/A")
        else:
            out.append(f"{key}: {float(values[key]):.4f}")
        day -= timedelta(days=1)
    header = f"## {indicator} values from {start.isoformat()} to {as_of_date}:\n\n"
    return header + "\n".join(out) + "\n\n" + INDICATORS[indicator]


def _financial(symbol: str, kind: FinancialKind, annual: bool, title: str) -> str:
    code = _code(symbol)
    period: Literal["year", "quarter"] = "year" if annual else "quarter"
    rows = _call(lambda c: financials(c, code, kind, period, PRIORITY))
    if not rows:
        raise NoMarketDataError(symbol, code, f"{title} 데이터가 없습니다")
    label = "연간" if annual else "분기"
    return as_markdown(kind, rows, f"{symbol} {title} ({label})")


def get_fundamentals(ticker: str, as_of_date: str | None = None) -> str:
    return _financial(ticker, "financial_ratio", True, "재무비율")


def get_balance_sheet(ticker: str, freq: str = "quarterly", as_of_date: str | None = None) -> str:
    return _financial(ticker, "balance_sheet", freq == "annual", "재무상태표")


def get_income_statement(
    ticker: str, freq: str = "quarterly", as_of_date: str | None = None
) -> str:
    return _financial(ticker, "income_statement", freq == "annual", "손익계산서")


def get_cashflow(ticker: str, freq: str = "quarterly", as_of_date: str | None = None) -> str:
    raise NoMarketDataError(ticker, None, "한국투자증권 API에는 현금흐름표가 없습니다")


def get_insider_transactions(ticker: str, as_of_date: str | None = None) -> str:
    raise NoMarketDataError(ticker, None, "한국투자증권 API에는 내부자 거래 정보가 없습니다")


def get_news(ticker: str, start_date: str, end_date: str) -> str:
    code = _code(ticker)
    start, end = _day(start_date), _day(end_date)
    items = _call(lambda c: news_titles(c, code, 40, PRIORITY))
    hits = [n for n in items if start <= n.at.date() <= end]
    if not hits:
        raise NoMarketDataError(ticker, code, f"{start_date}~{end_date} 뉴스 제목이 없습니다")
    lines = [f"## {ticker} 뉴스 제목 ({start_date} ~ {end_date}, 출처: 한국투자증권)", ""]
    lines += [f"- {n.at:%Y-%m-%d %H:%M} [{n.source}] {n.title}" for n in hits]
    return "\n".join(lines)


_FUNCTIONS: dict[str, Callable[..., str]] = {
    "get_stock_data": get_stock_data,
    "get_indicators": get_indicators,
    "get_fundamentals": get_fundamentals,
    "get_balance_sheet": get_balance_sheet,
    "get_income_statement": get_income_statement,
    "get_cashflow": get_cashflow,
    "get_news": get_news,
    "get_insider_transactions": get_insider_transactions,
}


def install_kis_vendor() -> None:
    """TradingAgents의 공급자 표에 `kis`를 넣는다. 여러 번 불러도 같다."""
    methods: dict[str, dict[str, Any]] = router.VENDOR_METHODS
    for method, fn in _FUNCTIONS.items():
        methods[method][VENDOR] = fn
