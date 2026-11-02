from collections.abc import Callable
from datetime import date
from typing import Any

import httpx
import respx

from vater_core.kis.client import KisClient
from vater_core.kis.config import REST_HOST, KisServer
from vater_core.kis.models import Bar, signed_change
from vater_core.kis.quotes import (
    domestic_daily,
    domestic_price,
    is_domestic_trading_day,
    overseas_daily,
    overseas_price,
)

HOST = REST_HOST[KisServer.PROD]
Fx = Callable[[str], dict[str, Any]]


def ok(data: dict[str, Any]) -> httpx.Response:
    return httpx.Response(200, json=data)


def test_signed_change_uses_sign_code() -> None:
    assert signed_change("6.63", "5") == -6.63  # 하락
    assert signed_change("6.63", "4") == -6.63  # 하한
    assert signed_change("-500", "5") == -500  # 이미 음수여도 한 번만 음수
    assert signed_change("5000", "2") == 5000  # 상승
    assert signed_change("", "3") == 0  # 빈 값은 0


@respx.mock
async def test_domestic_price(kis: KisClient, fixture: Fx) -> None:
    route = respx.get(f"{HOST}/uapi/domestic-stock/v1/quotations/inquire-price").mock(
        return_value=ok(fixture("domestic_price"))
    )
    q = await domestic_price(kis, "005930")
    assert (q.market, q.code, q.price, q.change, q.change_pct, q.volume) == (
        "KR", "005930", 230000.0, 5000.0, 2.22, 14537981)  # fmt: skip
    req = route.calls[0].request
    assert req.headers["tr_id"] == "FHKST01010100"
    assert dict(req.url.params) == {"FID_COND_MRKT_DIV_CODE": "J", "FID_INPUT_ISCD": "005930"}


@respx.mock
async def test_overseas_price_applies_sign(kis: KisClient, fixture: Fx) -> None:
    route = respx.get(f"{HOST}/uapi/overseas-price/v1/quotations/price").mock(
        return_value=ok(fixture("overseas_price"))
    )
    q = await overseas_price(kis, "NAS", "AAPL")
    assert (q.market, q.code, q.price, q.change, q.change_pct) == (
        "US",
        "AAPL",
        338.0,
        -6.63,
        -1.92,
    )
    assert dict(route.calls[0].request.url.params) == {"AUTH": "", "EXCD": "NAS", "SYMB": "AAPL"}


@respx.mock
async def test_domestic_daily_parses_sorted_bars(kis: KisClient, fixture: Fx) -> None:
    respx.get(f"{HOST}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice").mock(
        return_value=ok(fixture("domestic_daily"))
    )
    bars = await domestic_daily(kis, "005930", date(2026, 10, 30), date(2026, 11, 2))
    assert [b.day for b in bars] == sorted(b.day for b in bars)  # 오래된 날짜부터
    assert bars[-1] == Bar(date(2026, 11, 2), 219000.0, 232000.0, 217000.0, 230000.0, 14537981)


@respx.mock
async def test_domestic_daily_paginates_over_100_rows(kis: KisClient, fixture: Fx) -> None:
    def rows(end: date, n: int) -> list[dict[str, str]]:
        out = []
        for i in range(n):
            d = date.fromordinal(end.toordinal() - i)
            out.append({"stck_bsop_date": d.strftime("%Y%m%d"), "stck_oprc": "1", "stck_hgpr": "1",
                        "stck_lwpr": "1", "stck_clpr": str(i), "acml_vol": "1"})  # fmt: skip
        return out

    calls: list[str] = []

    def responder(request: httpx.Request) -> httpx.Response:
        end = request.url.params["FID_INPUT_DATE_2"]
        calls.append(end)
        end_d = date(int(end[:4]), int(end[4:6]), int(end[6:]))
        n = 100 if len(calls) == 1 else 20
        return ok({"rt_cd": "0", "msg_cd": "", "msg1": "", "output2": rows(end_d, n)})

    respx.get(f"{HOST}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice").mock(
        side_effect=responder
    )
    bars = await domestic_daily(kis, "005930", date(2026, 3, 1), date(2026, 11, 2))
    assert len(calls) == 2 and len(bars) == 120
    assert len({b.day for b in bars}) == 120  # 중복 없음


@respx.mock
async def test_overseas_daily(kis: KisClient, fixture: Fx) -> None:
    route = respx.get(f"{HOST}/uapi/overseas-price/v1/quotations/dailyprice").mock(
        return_value=ok(fixture("overseas_daily"))
    )
    bars = await overseas_daily(kis, "NAS", "AAPL", date(2026, 11, 2))
    assert bars[-1].day == date(2026, 11, 2) and bars[-1].close == 338.0
    assert route.calls[0].request.url.params["GUBN"] == "0"
    assert route.calls[0].request.url.params["BYMD"] == "20261102"


@respx.mock
async def test_trading_day(kis: KisClient, fixture: Fx) -> None:
    respx.get(f"{HOST}/uapi/domestic-stock/v1/quotations/chk-holiday").mock(
        return_value=ok(fixture("domestic_holiday"))
    )
    assert await is_domestic_trading_day(kis, date(2026, 11, 3)) is True


@respx.mock
async def test_holiday(kis: KisClient, fixture: Fx) -> None:
    data = fixture("domestic_holiday")
    data["output"][0]["opnd_yn"] = "N"
    respx.get(f"{HOST}/uapi/domestic-stock/v1/quotations/chk-holiday").mock(return_value=ok(data))
    assert await is_domestic_trading_day(kis, date(2026, 11, 3)) is False
