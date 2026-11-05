"""평가금액과 환율 (v2 설계 4-1, 12장). 값을 지어내지 않는다."""

from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import httpx
import pytest

from vater_core.api.deps import AppDeps
from vater_core.api.errors import VaterError
from vater_core.portfolio.service import PortfolioService
from vater_core.portfolio.valuation import value_of
from vater_core.store.holdings import HoldingRow, HoldingsRepo

NOW = datetime(2026, 11, 5, 14, 0, tzinfo=ZoneInfo("Asia/Seoul"))
AT = "2026-11-05T14:00:00Z"
Prices = dict[tuple[str, str], float | Exception]


def test_value_of_the_spec_example() -> None:
    v = value_of(Decimal(15), Decimal(64000), 71400)
    assert (v.value, v.cost, v.pl) == (1071000, 960000, 111000)
    assert v.pl_pct == pytest.approx(11.5625)


def test_value_of_without_a_price_invents_nothing() -> None:
    v = value_of(Decimal(15), Decimal(64000), None)
    assert (v.value, v.cost, v.pl, v.pl_pct) == (None, 960000, None, None)


def test_value_of_without_an_average_has_no_profit() -> None:
    v = value_of(Decimal(15), None, 71400)
    assert (v.value, v.cost, v.pl, v.pl_pct) == (1071000, None, None, None)


def test_quantity_without_an_average_is_left_out_of_profit_only() -> None:
    v = value_of(Decimal(15), Decimal(100), 110, unpriced=Decimal(5))
    assert (v.value, v.cost, v.pl) == (1650, 1000, 100)
    assert v.pl_pct == pytest.approx(10)


def service(
    deps: AppDeps,
    prices: Prices,
    fx: float | Exception | None = 1400.0,
) -> tuple[PortfolioService, dict[str, int]]:
    calls = {"price": 0, "fx": 0}

    async def fetch_price(market: str, code: str) -> float:
        calls["price"] += 1
        got = prices.get((market, code), RuntimeError("no price"))
        if isinstance(got, Exception):
            raise got
        return got

    async def fetch_fx() -> float | None:
        calls["fx"] += 1
        if isinstance(fx, Exception):
            raise fx
        return fx

    made = PortfolioService(deps, fetch_price=fetch_price, fetch_fx=fetch_fx, now=lambda: NOW)
    deps.portfolio = made
    return made, calls


def hold(deps: AppDeps, *rows: HoldingRow, broker: str = "samsung") -> None:
    assert deps.db is not None
    repo = HoldingsRepo(deps.db)
    for row in rows:
        repo.manual_upsert(broker, row, AT)


SAMSUNG = HoldingRow("KR", "005930", "삼성전자", Decimal(15), Decimal(64000), "KRW")
APPLE = HoldingRow("US", "AAPL", "애플", Decimal("0.5"), Decimal(100), "USD")


async def test_summary_keeps_currencies_apart_and_converts_once(
    client: httpx.AsyncClient, deps: AppDeps
) -> None:
    hold(deps, SAMSUNG, APPLE)
    service(deps, {("KR", "005930"): 71400, ("US", "AAPL"): 120})
    got = (await client.get("/portfolio/summary")).json()
    assert got["currencies"]["KRW"]["value"] == 1071000
    assert got["currencies"]["USD"]["value"] == 60
    assert got["currencies"]["USD"]["pl"] == 10
    assert got["total_krw"]["value"] == 1071000 + 60 * 1400
    assert got["total_krw"]["cost"] == 960000 + 50 * 1400
    assert got["usdkrw"] == 1400 and got["missing_prices"] == 0
    row = next(s for s in got["symbols"] if s["code"] == "AAPL")
    assert (row["total"], row["price"], row["value"], row["currency"]) == ("0.5", 120, 60, "USD")


async def test_one_failed_price_leaves_that_symbol_blank_only(
    client: httpx.AsyncClient, deps: AppDeps
) -> None:
    hold(deps, SAMSUNG, HoldingRow("KR", "000660", "SK", Decimal(1), Decimal(100), "KRW"))
    service(deps, {("KR", "000660"): 200})
    got = (await client.get("/portfolio/summary")).json()
    assert got["missing_prices"] == 1
    assert got["currencies"]["KRW"]["value"] == 200
    row = next(s for s in got["symbols"] if s["code"] == "005930")
    assert (row["price"], row["value"], row["pl"]) == (None, None, None)


async def test_without_a_rate_the_converted_total_is_blank_but_currencies_stay(
    client: httpx.AsyncClient, deps: AppDeps
) -> None:
    hold(deps, SAMSUNG, APPLE)
    service(deps, {("KR", "005930"): 71400, ("US", "AAPL"): 120}, fx=VaterError("X", "실패"))
    got = (await client.get("/portfolio/summary")).json()
    assert got["usdkrw"] is None and got["total_krw"] is None
    assert got["currencies"]["USD"]["value"] == 60


async def test_won_only_needs_no_rate(client: httpx.AsyncClient, deps: AppDeps) -> None:
    hold(deps, SAMSUNG)
    _, calls = service(deps, {("KR", "005930"): 71400}, fx=None)
    got = (await client.get("/portfolio/summary")).json()
    assert got["total_krw"]["value"] == 1071000 and calls["fx"] == 0


async def test_empty_and_unsupported_markets(client: httpx.AsyncClient, deps: AppDeps) -> None:
    hold(deps, HoldingRow(None, "7203", "토요타", Decimal(1), Decimal(1), "JPY"))
    service(deps, {})
    got = (await client.get("/portfolio/summary")).json()
    assert got["symbols"] == [] and got["currencies"] == {} and got["total_krw"] is None
    assert got["unsupported"] == 1


async def test_prices_are_reused_within_the_refresh_setting(
    client: httpx.AsyncClient, deps: AppDeps
) -> None:
    hold(deps, SAMSUNG)
    _, calls = service(deps, {("KR", "005930"): 71400})
    await client.get("/portfolio/summary")
    await client.get("/portfolio/summary")
    assert calls["price"] == 1


async def test_the_rate_is_kept_for_the_day_until_refresh(
    client: httpx.AsyncClient, deps: AppDeps
) -> None:
    _, calls = service(deps, {}, fx=1400.0)
    first = (await client.get("/market/fx")).json()
    await client.get("/market/fx")
    assert first == {"usdkrw": 1400, "day": "2026-11-05"} and calls["fx"] == 1
    await client.get("/market/fx", params={"refresh": "true"})
    assert calls["fx"] == 2


async def test_failed_refresh_keeps_the_rate_already_saved(
    client: httpx.AsyncClient, deps: AppDeps
) -> None:
    made, _ = service(deps, {}, fx=1400.0)
    await client.get("/market/fx")

    async def down() -> float:
        raise RuntimeError("down")

    made._fetch_fx = down  # type: ignore[assignment]
    got = (await client.get("/market/fx", params={"refresh": "true"})).json()
    assert got["usdkrw"] == 1400


async def test_failed_rate_with_nothing_saved_is_null(
    client: httpx.AsyncClient, deps: AppDeps
) -> None:
    service(deps, {}, fx=RuntimeError("down"))
    assert (await client.get("/market/fx")).json() == {"usdkrw": None, "day": "2026-11-05"}
