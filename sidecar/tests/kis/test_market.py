from collections.abc import Callable
from datetime import date
from typing import Any

import httpx
import respx

from vater_core.kis.client import KisClient
from vater_core.kis.config import REST_HOST, KisServer
from vater_core.kis.market import (
    fluctuation_rank,
    index_daily,
    index_quote,
    investor_flows,
    overseas_index,
    sector_board,
    trading_value_rank,
)

HOST = REST_HOST[KisServer.PROD]
Q = "/uapi/domestic-stock/v1/quotations"
Fx = Callable[[str], dict[str, Any]]


def ok(data: dict[str, Any]) -> httpx.Response:
    return httpx.Response(200, json=data)


@respx.mock
async def test_index_quote(kis: KisClient, fixture: Fx) -> None:
    route = respx.get(f"{HOST}{Q}/inquire-index-price").mock(
        return_value=ok(fixture("index_price"))
    )
    q = await index_quote(kis, "KOSDAQ")
    assert (q.name, q.value, q.change, q.change_pct) == ("KOSDAQ", 5859.08, 128.34, 2.24)
    assert dict(route.calls[0].request.url.params) == {
        "FID_COND_MRKT_DIV_CODE": "U",
        "FID_INPUT_ISCD": "1001",
    }
    assert route.calls[0].request.headers["tr_id"] == "FHPUP02100000"


@respx.mock
async def test_sector_board(kis: KisClient, fixture: Fx) -> None:
    route = respx.get(f"{HOST}{Q}/inquire-index-category-price").mock(
        return_value=ok(fixture("sector_indices"))
    )
    board = await sector_board(kis, "KOSPI")
    assert board.index.value == 5859.08 and (board.advancers, board.decliners) == (653, 230)
    assert board.sectors[1].name == "대형주" and board.sectors[1].change_pct == 2.27
    p = route.calls[0].request.url.params
    assert (p["FID_INPUT_ISCD"], p["FID_MRKT_CLS_CODE"], p["FID_COND_SCR_DIV_CODE"]) == (
        "0001",
        "K",
        "20214",
    )


@respx.mock
async def test_fluctuation_rank_down_uses_code_3_and_drops_risers(
    kis: KisClient, fixture: Fx
) -> None:
    """실연동: 정렬 코드 1은 상승 종목이 섞여 온다. 3을 쓰고, 받은 뒤에도 하락 종목만 남긴다."""
    data = fixture("fluctuation_rank")
    data["output"] = [
        {**data["output"][0], "hts_kor_isnm": "A", "prdy_ctrt": "-50.00", "data_rank": "1"},
        {**data["output"][0], "hts_kor_isnm": "B", "prdy_ctrt": "18.24", "data_rank": "2"},
        {**data["output"][0], "hts_kor_isnm": "C", "prdy_ctrt": "-30.00", "data_rank": "3"},
    ]
    route = respx.get(f"{HOST}/uapi/domestic-stock/v1/ranking/fluctuation").mock(
        return_value=ok(data)
    )
    items = await fluctuation_rank(kis, "down", limit=5)
    assert [i.name for i in items] == ["A", "C"]  # 상승 종목 B 제외, 많이 내린 순
    assert route.calls[0].request.url.params["fid_rank_sort_cls_code"] == "3"


@respx.mock
async def test_trading_value_rank(kis: KisClient, fixture: Fx) -> None:
    route = respx.get(f"{HOST}{Q}/volume-rank").mock(return_value=ok(fixture("volume_rank")))
    items = await trading_value_rank(kis, limit=3)
    assert items[0].name == "SK하이닉스" and items[0].code == "000660"
    assert items[0].trading_value == 3772550907797 and items[0].change_pct == 4.37
    assert route.calls[0].request.url.params["FID_BLNG_CLS_CODE"] == "3"  # 거래금액순


@respx.mock
async def test_investor_flows(kis: KisClient, fixture: Fx) -> None:
    route = respx.get(f"{HOST}{Q}/inquire-investor-daily-by-market").mock(
        return_value=ok(fixture("investor_daily"))
    )
    f = await investor_flows(kis, "KOSPI", date(2026, 11, 2))
    assert (f.foreign, f.institution, f.individual) == (-383213, 1224464, -1315092)  # 백만원
    p = route.calls[0].request.url.params
    assert (p["FID_INPUT_ISCD"], p["FID_INPUT_ISCD_1"], p["FID_INPUT_DATE_1"]) == (
        "0001",
        "KSP",
        "20261102",
    )


@respx.mock
async def test_overseas_index(kis: KisClient, fixture: Fx) -> None:
    route = respx.get(f"{HOST}/uapi/overseas-price/v1/quotations/inquire-daily-chartprice").mock(
        return_value=ok(fixture("overseas_index"))
    )
    ix = await overseas_index(kis, "SPX", date(2026, 10, 23), date(2026, 11, 2))
    assert ix.quote.name == "S&P500" and ix.quote.value == 7614.92 and ix.quote.change == 34.85
    assert ix.bars[-1].day == date(2026, 11, 2) and ix.bars[-1].close == 7614.92
    assert route.calls[0].request.url.params["FID_COND_MRKT_DIV_CODE"] == "N"


@respx.mock
async def test_index_daily_is_oldest_first(kis: KisClient, fixture: Fx) -> None:
    # 실제 응답(2026-11-03 장중): 최신 날짜부터 오고, 오늘의 미확정 행도 들어 있다
    route = respx.get(f"{HOST}{Q}/inquire-daily-indexchartprice").mock(
        return_value=ok(fixture("index_daily"))
    )
    bars = await index_daily(kis, "KOSPI", date(2026, 9, 1), date(2026, 11, 3))
    assert [b.day for b in bars] == sorted(b.day for b in bars)
    assert bars[-1].day == date(2026, 11, 3) and bars[-1].close == 5695.99
    assert (bars[-1].open, bars[-1].high, bars[-1].low) == (5715.19, 5735.92, 5638.06)
    assert dict(route.calls[0].request.url.params) == {
        "FID_COND_MRKT_DIV_CODE": "U",
        "FID_INPUT_ISCD": "0001",
        "FID_INPUT_DATE_1": "20260901",
        "FID_INPUT_DATE_2": "20261103",
        "FID_PERIOD_DIV_CODE": "D",
    }
    assert route.calls[0].request.headers["tr_id"] == "FHKUP03500100"
