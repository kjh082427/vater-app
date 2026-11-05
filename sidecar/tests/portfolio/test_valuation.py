"""평가금액과 환율 (v2 설계 4-1, 12장). 값을 지어내지 않는다."""

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import pytest

from vater_core.api.deps import AppDeps
from vater_core.api.errors import VaterError
from vater_core.market.fx import FxRepo, fetch_usdkrw
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
    fx: float | tuple[date, float] | Exception | None = 1400.0,
) -> tuple[PortfolioService, dict[str, int]]:
    calls = {"price": 0, "fx": 0}

    async def fetch_price(market: str, code: str) -> float:
        calls["price"] += 1
        got = prices.get((market, code), RuntimeError("no price"))
        if isinstance(got, Exception):
            raise got
        return got

    async def fetch_fx() -> tuple[date, float] | None:
        calls["fx"] += 1
        if isinstance(fx, Exception):
            raise fx
        return (NOW.date(), fx) if isinstance(fx, float) else fx

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


async def test_converted_percent_uses_only_the_cost_that_has_a_profit(
    client: httpx.AsyncClient, deps: AppDeps
) -> None:
    hold(deps, SAMSUNG, HoldingRow("KR", "000660", "SK", Decimal(1), Decimal(100), "KRW"))
    service(deps, {("KR", "000660"): 200})  # 삼성전자 시세 실패: 매입금액 960,000은 손익이 없다
    got = (await client.get("/portfolio/summary")).json()
    assert got["currencies"]["KRW"]["pl_pct"] == pytest.approx(100.0)
    assert got["total_krw"]["pl_pct"] == pytest.approx(100.0)
    assert got["total_krw"]["cost"] == 960100


async def test_summary_shows_quantity_without_an_average(
    client: httpx.AsyncClient, deps: AppDeps
) -> None:
    hold(deps, SAMSUNG)
    hold(deps, HoldingRow("KR", "005930", "삼성전자", Decimal(5), None, "KRW"), broker="mirae")
    hold(deps, HoldingRow("KR", "000660", "SK", Decimal(1), Decimal(100), "KRW"))
    service(deps, {("KR", "005930"): 71400, ("KR", "000660"): 200})
    got = (await client.get("/portfolio/summary")).json()
    rows = {s["code"]: s["unpriced_quantity"] for s in got["symbols"]}
    assert rows == {"005930": "5", "000660": "0"}


async def test_fetch_looks_back_seven_days_and_returns_the_real_day() -> None:
    today = date(2026, 11, 9)
    seen: dict[str, Any] = {}

    class Client:
        async def get(self, path: str, tr: str, params: dict[str, str], priority: Any) -> Any:
            seen.update(params)
            return {
                "output2": [
                    {"stck_bsop_date": "20261106", "ovrs_nmix_prpr": "1390.5"},
                    {"stck_bsop_date": "20261105", "ovrs_nmix_prpr": "1380"},
                    {
                        "stck_bsop_date": "20261110",
                        "ovrs_nmix_prpr": "9999",
                    },  # 미래 값은 쓰지 않는다
                ]
            }

    assert await fetch_usdkrw(Client(), today) == (date(2026, 11, 6), 1390.5)  # type: ignore[arg-type]
    assert seen["FID_INPUT_DATE_1"] == "20261102"
    assert seen["FID_INPUT_DATE_2"] == "20261109"


async def test_older_rate_is_saved_under_its_own_day(
    client: httpx.AsyncClient, deps: AppDeps
) -> None:
    assert deps.db is not None
    friday = NOW.date() - timedelta(days=2)
    _, calls = service(deps, {}, fx=(friday, 1390.0))
    assert (await client.get("/market/fx")).json() == {"usdkrw": 1390, "day": friday.isoformat()}
    assert FxRepo(deps.db).get(friday) == 1390
    assert FxRepo(deps.db).get(NOW.date()) is None  # 지난 값이 오늘 환율로 굳지 않는다
    await client.get("/market/fx")
    assert calls["fx"] == 1  # 조회 주기 안에서는 다시 묻지 않는다
    await client.get("/market/fx", params={"refresh": "true"})
    assert calls["fx"] == 2


@pytest.mark.parametrize(("age", "expected"), [(3, 1390.0), (7, 1390.0), (8, None)])
async def test_failed_lookup_uses_a_saved_rate_within_seven_days(
    client: httpx.AsyncClient, deps: AppDeps, age: int, expected: float | None
) -> None:
    assert deps.db is not None
    saved = NOW.date() - timedelta(days=age)
    FxRepo(deps.db).save(saved, 1390.0)
    service(deps, {}, fx=RuntimeError("down"))
    day = saved if expected else NOW.date()
    got = (await client.get("/market/fx")).json()
    assert got == {"usdkrw": expected, "day": day.isoformat()}


async def test_summary_converts_with_a_recent_saved_rate(
    client: httpx.AsyncClient, deps: AppDeps
) -> None:
    assert deps.db is not None
    FxRepo(deps.db).save(NOW.date() - timedelta(days=1), 1390.0)
    hold(deps, APPLE)
    service(deps, {("US", "AAPL"): 120}, fx=RuntimeError("down"))
    got = (await client.get("/portfolio/summary")).json()
    assert got["usdkrw"] == 1390
