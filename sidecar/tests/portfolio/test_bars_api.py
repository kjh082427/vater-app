"""종목 일봉 API와 조회 주기 설정 (v2 설계 3장)."""

from datetime import UTC, date, datetime, timedelta

import httpx
import pytest

from vater_core.alerts.clock import MarketClock
from vater_core.alerts.monitor import AlertMonitor
from vater_core.alerts.store import BarRepo, WatchItem
from vater_core.api.deps import AppDeps
from vater_core.kis.models import Bar, Quote

LAST = date(2026, 11, 3)
NOW = datetime(2026, 11, 3, 8, 0, tzinfo=UTC)  # 17:00 KST: 화요일 마감 후


@pytest.fixture(autouse=True)
def symbols(deps: AppDeps) -> None:
    assert deps.db is not None
    deps.db.executemany(
        "INSERT INTO symbols (market, code, exchange, name, name_en, kind) VALUES (?,?,?,?,?,?)",
        [
            ("KR", "005930", "KOSPI", "삼성전자", None, "stock"),
            ("US", "AAPL", "NAS", "애플", "APPLE INC", "stock"),
        ],
    )
    deps.db.commit()


def seed(deps: AppDeps, market: str, code: str, days: int = 400) -> None:
    assert deps.db is not None
    bars = [Bar(LAST - timedelta(d), 1, 1, 1, 100 + d, 1) for d in range(days)]
    BarRepo(deps.db).upsert(market, code, bars)


@pytest.mark.parametrize(("rng", "span"), [("1m", 31), ("3m", 92), ("1y", 366)])
async def test_bars_by_range(client: httpx.AsyncClient, deps: AppDeps, rng: str, span: int) -> None:
    seed(deps, "KR", "005930")
    r = await client.get("/symbols/KR/005930/bars", params={"range": rng})
    assert r.status_code == 200
    body = r.json()
    assert len(body) == span
    assert body[-1] == {"day": "2026-11-03", "close": 100.0}  # 오래된 것부터
    assert body[0]["day"] < body[1]["day"]


async def test_us_symbol_bars(client: httpx.AsyncClient, deps: AppDeps) -> None:
    seed(deps, "US", "AAPL", days=10)
    r = await client.get("/symbols/US/aapl/bars", params={"range": "1m"})
    assert r.status_code == 200 and len(r.json()) == 10


async def test_without_kis_key_is_an_empty_list(client: httpx.AsyncClient) -> None:
    r = await client.get("/symbols/KR/005930/bars", params={"range": "1m"})
    assert (r.status_code, r.json()) == (200, [])


async def test_unknown_symbol_and_bad_range(client: httpx.AsyncClient) -> None:
    r = await client.get("/symbols/KR/999999/bars", params={"range": "1m"})
    assert (r.status_code, r.json()["code"]) == (404, "SYMBOL_UNKNOWN")
    bad = await client.get("/symbols/KR/005930/bars", params={"range": "5y"})
    assert (bad.status_code, bad.json()["code"]) == (422, "REQUEST_INVALID")
    market = await client.get("/symbols/JP/7203/bars", params={"range": "1m"})
    assert market.status_code == 422


async def test_stale_bars_are_refreshed_first(client: httpx.AsyncClient, deps: AppDeps) -> None:
    assert deps.db is not None
    calls: list[str] = []

    async def trading_day(day: date) -> bool:
        return day.weekday() < 5

    async def bars(item: WatchItem, through: date) -> int:
        calls.append(item.code)
        assert deps.db is not None
        return BarRepo(deps.db).upsert(item.market, item.code, [Bar(through, 1, 1, 1, 77, 1)])

    async def price(item: WatchItem) -> Quote:
        raise AssertionError("현재가는 부르지 않는다")

    deps.alerts = AlertMonitor(
        deps,
        clock=MarketClock(trading_day, lambda: NOW),
        realtime_factory=lambda *_: None,  # type: ignore[arg-type,return-value]
        price_fn=price,
        bars_fn=bars,
    )
    r = await client.get("/symbols/KR/005930/bars", params={"range": "1m"})
    assert r.json() == [{"day": "2026-11-03", "close": 77.0}]
    await client.get("/symbols/KR/005930/bars", params={"range": "1m"})
    assert calls == ["005930"]  # 최신이면 다시 받지 않는다


@pytest.mark.parametrize("value", [10, 45, 0, "600", True, 7200])
async def test_bad_refresh_sec_is_422(client: httpx.AsyncClient, value: object) -> None:
    r = await client.patch("/settings", json={"quotes.refresh_sec": value})
    assert (r.status_code, r.json()["code"]) == (422, "SETTING_INVALID")


async def test_refresh_sec_default_and_choice(client: httpx.AsyncClient) -> None:
    assert (await client.get("/settings")).json()["quotes.refresh_sec"] == 600
    r = await client.patch("/settings", json={"quotes.refresh_sec": 30})
    assert r.status_code == 200
