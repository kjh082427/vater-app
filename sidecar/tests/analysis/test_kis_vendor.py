"""국내 종목 데이터 공급자 `kis`. 응답 본문은 core/kis 실연동의 실제 응답이다.

공급자 함수는 TradingAgents의 워커 스레드에서 불리므로, 테스트도 `asyncio.to_thread`로 부른다.
"""

import asyncio
from collections.abc import Callable
from datetime import date, timedelta
from typing import Any

import pytest
import respx

from vater_core.analysis import kis_vendor as kv
from vater_core.kis.client import KisClient
from vater_core.kis.config import REST_HOST, KisServer

HOST = REST_HOST[KisServer.PROD]
Fx = Callable[[str], dict[str, Any]]
DAILY = f"{HOST}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice"
NEWS = f"{HOST}/uapi/domestic-stock/v1/quotations/news-title"


def daily_rows(n: int, last: date) -> dict[str, Any]:
    """`n` 거래일(주말 제외)의 일봉. 종가가 매일 조금씩 오른다. 최신이 앞."""
    rows: list[dict[str, str]] = []
    d, price = last, 50000 + n * 100
    while len(rows) < n:
        if d.weekday() < 5:
            rows.append(
                {
                    "stck_bsop_date": d.strftime("%Y%m%d"),
                    "stck_oprc": str(price - 50),
                    "stck_hgpr": str(price + 200),
                    "stck_lwpr": str(price - 300),
                    "stck_clpr": str(price),
                    "acml_vol": "1000000",
                }
            )
            price -= 100 if len(rows) % 3 else -40
        d -= timedelta(days=1)
    return {"rt_cd": "0", "msg_cd": "", "msg1": "", "output1": {}, "output2": rows}


async def in_thread(kis: KisClient, fn: Any, *args: Any) -> Any:
    with kv.kis_session(kv.KisBridge(kis, asyncio.get_running_loop())):
        return await asyncio.to_thread(fn, *args)


@respx.mock
async def test_stock_data_csv(kis: KisClient, kis_fixture: Fx) -> None:
    route = respx.get(DAILY).respond(json=kis_fixture("domestic_daily"))
    out = await in_thread(kis, kv.get_stock_data, "005930.KS", "2026-10-29", "2026-11-02")
    assert out.startswith("# Stock data for 005930.KS from 2026-10-29 to 2026-11-02")
    assert "Date,Open,High,Low,Close,Volume" in out
    assert "2026-11-02,219000.0,232000.0,217000.0,230000.0,14537981" in out
    assert route.calls[0].request.url.params["FID_INPUT_ISCD"] == "005930"


@respx.mock
async def test_indicator_rsi_values(kis: KisClient) -> None:
    respx.get(DAILY).respond(json=daily_rows(60, date(2026, 11, 2)))
    out = await in_thread(kis, kv.get_indicators, "005930.KS", "rsi", "2026-11-02", 7)
    assert out.startswith("## rsi values from 2026-10-26 to 2026-11-02")
    lines = [line for line in out.splitlines() if line[:4] == "2026"]
    assert [line[:10] for line in lines] == [
        "2026-11-02",
        "2026-11-01",
        "2026-10-31",
        "2026-10-30",
        "2026-10-29",
        "2026-10-28",
        "2026-10-27",
        "2026-10-26",
    ]
    assert "Not a trading day" in lines[1]  # 일요일
    value = float(lines[0].split(": ")[1])
    assert 0 <= value <= 100


async def test_unsupported_indicator_is_value_error(kis: KisClient) -> None:
    with pytest.raises(ValueError, match="not supported"):
        await in_thread(kis, kv.get_indicators, "005930.KS", "ichimoku", "2026-11-02", 7)


@respx.mock
async def test_financial_markdown(kis: KisClient, kis_fixture: Fx) -> None:
    respx.get(f"{HOST}/uapi/domestic-stock/v1/finance/income-statement").respond(
        json=kis_fixture("income_statement")
    )
    out = await in_thread(kis, kv.get_income_statement, "005930.KS", "quarterly", "2026-11-02")
    assert "손익계산서" in out and "억원" in out and "| 매출액 |" in out


@respx.mock
async def test_fundamentals_uses_ratio(kis: KisClient, kis_fixture: Fx) -> None:
    route = respx.get(f"{HOST}/uapi/domestic-stock/v1/finance/financial-ratio").respond(
        json=kis_fixture("financial_ratio")
    )
    out = await in_thread(kis, kv.get_fundamentals, "005930.KS", "2026-11-02")
    assert "재무비율" in out
    assert route.calls[0].request.url.params["FID_DIV_CLS_CODE"] == "0"  # 연간


@respx.mock
async def test_news_markdown_filters_dates(kis: KisClient, kis_fixture: Fx) -> None:
    respx.get(NEWS).respond(json=kis_fixture("news_title"))
    out = await in_thread(kis, kv.get_news, "005930.KS", "2026-10-27", "2026-11-02")
    assert out.startswith("## 005930.KS 뉴스 제목")
    assert "한국경제신문" in out
    with pytest.raises(Exception, match="No market data"):
        await in_thread(kis, kv.get_news, "005930.KS", "2025-01-01", "2025-01-07")


async def test_cashflow_and_insider_are_no_data(kis: KisClient) -> None:
    from tradingagents.dataflows.errors import NoMarketDataError

    with pytest.raises(NoMarketDataError):
        await in_thread(kis, kv.get_cashflow, "005930.KS", "quarterly", "2026-11-02")
    with pytest.raises(NoMarketDataError):
        await in_thread(kis, kv.get_insider_transactions, "005930.KS", "2026-11-02")


@respx.mock
async def test_kis_error_becomes_vendor_unavailable(kis: KisClient) -> None:
    from tradingagents.dataflows.errors import VendorUnavailableError

    respx.get(DAILY).respond(
        500, json={"rt_cd": "1", "msg_cd": "EGW00500", "msg1": "시스템 오류입니다"}
    )
    with pytest.raises(VendorUnavailableError):
        await in_thread(kis, kv.get_stock_data, "005930.KS", "2026-10-29", "2026-11-02")


@respx.mock
async def test_route_to_vendor_uses_kis(kis: KisClient, kis_fixture: Fx) -> None:
    """TradingAgents의 라우터가 `tool_vendors` 설정으로 이 공급자를 고른다."""
    from tradingagents.dataflows.config import set_config
    from tradingagents.dataflows.router import route_to_vendor
    from tradingagents.default_config import DEFAULT_CONFIG

    kv.install_kis_vendor()
    kv.install_kis_vendor()  # 여러 번 불러도 같다
    respx.get(DAILY).respond(json=kis_fixture("domestic_daily"))
    set_config({**DEFAULT_CONFIG, "tool_vendors": dict.fromkeys(kv.KIS_TOOLS, "kis")})
    try:
        out = await in_thread(
            kis, route_to_vendor, "get_stock_data", "005930.KS", "2026-10-29", "2026-11-02"
        )
    finally:
        set_config(dict(DEFAULT_CONFIG))
    assert "2026-11-02,219000.0" in out


def test_session_must_not_overlap(kis: KisClient) -> None:
    loop = asyncio.new_event_loop()
    try:
        bridge = kv.KisBridge(kis, loop)
        with kv.kis_session(bridge), pytest.raises(RuntimeError), kv.kis_session(bridge):
            pass
        with kv.kis_session(bridge):  # 앞 세션이 끝났으면 다시 열 수 있다
            pass
    finally:
        loop.close()


def test_calls_without_session_fail() -> None:
    with pytest.raises(RuntimeError, match="session"):
        kv.get_stock_data("005930.KS", "2026-10-29", "2026-11-02")
