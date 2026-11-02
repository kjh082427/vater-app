from collections.abc import Callable
from datetime import date
from typing import Any

import httpx
import respx

from vater_core.kis.client import KisClient
from vater_core.kis.config import REST_HOST, KisServer
from vater_core.kis.market import (
    fluctuation_rank,
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
async def test_fluctuation_rank_down_uses_sort_code_1(kis: KisClient, fixture: Fx) -> None:
    route = respx.get(f"{HOST}/uapi/domestic-stock/v1/ranking/fluctuation").mock(
        return_value=ok(fixture("fluctuation_rank"))
    )
    items = await fluctuation_rank(kis, "down", limit=2)
    assert len(items) == 2 and items[0].rank == 1 and items[0].code
    assert route.calls[0].request.url.params["fid_rank_sort_cls_code"] == "1"


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
