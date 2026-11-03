"""지수 보드: 현재값 + 최근 30거래일 종가, 30초 캐시 (대시보드 설계 4장)."""

import asyncio
from collections import Counter
from datetime import UTC, date, datetime, timedelta

import pytest

from vater_core.kis.market import IndexQuote, OverseasIndex
from vater_core.kis.models import Bar
from vater_core.market.indices import IndexBoard

NOW = datetime(2026, 11, 3, 5, 0, tzinfo=UTC)  # 화 14:00 KST(국내 장중), 뉴욕은 11월 3일 00:00


def bars(n: int, last: date, start_close: float = 100.0) -> list[Bar]:
    days = [last - timedelta(days=n - 1 - i) for i in range(n)]
    return [
        Bar(day=d, open=1, high=1, low=1, close=start_close + i, volume=0)
        for i, d in enumerate(days)
    ]


class FakeFetch:
    def __init__(self, fail: set[str] | None = None, delay: float = 0.0) -> None:
        self.calls: Counter[str] = Counter()
        self.fail = fail or set()
        self.delay = delay

    async def kr_quote(self, m: str) -> IndexQuote:
        self.calls[f"quote:{m}"] += 1
        await asyncio.sleep(self.delay)
        if m in self.fail:
            raise RuntimeError("boom")
        return IndexQuote(code=m, name=m, value=2583.27, change=21.48, change_pct=0.84)

    async def kr_daily(self, m: str, start: date, end: date) -> list[Bar]:
        self.calls[f"daily:{m}"] += 1
        # 장중: 마지막 봉이 오늘(미확정)
        return bars(41, date(2026, 11, 3))

    async def us_index(self, code: str, start: date, end: date) -> OverseasIndex:
        self.calls[f"us:{code}"] += 1
        if code in self.fail:
            raise RuntimeError("boom")
        q = IndexQuote(code=code, name=code, value=6000.5, change=-12.3, change_pct=-0.2)
        return OverseasIndex(quote=q, bars=bars(40, date(2026, 11, 2), 5000.0))


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def mono(self) -> float:
        return self.t


def board(clock: Clock) -> IndexBoard:
    return IndexBoard(now=clock.mono, clock=lambda: NOW)


async def test_rows_order_names_and_30_closes_oldest_first() -> None:
    rows = await board(Clock()).rows(FakeFetch(), key="k")
    assert [(r.code, r.name, r.market) for r in rows] == [
        ("KOSPI", "코스피", "KR"),
        ("KOSDAQ", "코스닥", "KR"),
        ("SPX", "S&P 500", "US"),
        ("COMP", "나스닥", "US"),
    ]
    for r in rows:
        assert len(r.closes) == 30 and r.closes == sorted(r.closes)
        assert r.at == NOW
    assert rows[0].value == 2583.27 and rows[0].change == 21.48 and rows[0].change_pct == 0.84
    assert rows[2].value == 6000.5 and rows[2].change == -12.3


async def test_today_unconfirmed_kr_bar_is_excluded() -> None:
    rows = await board(Clock()).rows(FakeFetch(), key="k")
    # 41개 중 마지막(오늘 11/3) 제외 → 11/2까지의 마지막 30개: 종가 110..139
    assert rows[0].closes[-1] == 139.0 and rows[0].closes[0] == 110.0


async def test_one_index_failure_only_nulls_that_index() -> None:
    rows = await board(Clock()).rows(FakeFetch(fail={"KOSDAQ", "COMP"}), key="k")
    by = {r.code: r for r in rows}
    assert by["KOSDAQ"].value is None and by["KOSDAQ"].change is None and by["KOSDAQ"].closes == []
    assert by["COMP"].value is None
    assert by["KOSPI"].value == 2583.27 and by["SPX"].value == 6000.5


async def test_cache_30_seconds_then_refetch() -> None:
    clock, fetch = Clock(), FakeFetch()
    b = board(clock)
    await b.rows(fetch, key="k")
    clock.t += 29
    await b.rows(fetch, key="k")
    assert fetch.calls["quote:KOSPI"] == 1 and fetch.calls["us:SPX"] == 1
    clock.t += 2
    await b.rows(fetch, key="k")
    assert fetch.calls["quote:KOSPI"] == 2


async def test_key_change_drops_cache() -> None:
    clock, fetch = Clock(), FakeFetch()
    b = board(clock)
    await b.rows(fetch, key="a")
    await b.rows(fetch, key="b")
    assert fetch.calls["quote:KOSPI"] == 2


async def test_concurrent_requests_share_one_fetch() -> None:
    fetch = FakeFetch(delay=0.05)
    b = board(Clock())
    results = await asyncio.gather(*(b.rows(fetch, key="k") for _ in range(5)))
    assert all(r == results[0] for r in results)
    assert set(fetch.calls.values()) == {1}


async def test_no_kis_gives_all_null_rows() -> None:
    rows = await board(Clock()).rows(None, key=None)
    assert [r.code for r in rows] == ["KOSPI", "KOSDAQ", "SPX", "COMP"]
    assert all(r.value is None and r.closes == [] and r.at is None for r in rows)


@pytest.mark.parametrize("n", [0, 5])
async def test_short_history_is_fine(n: int) -> None:
    class Short(FakeFetch):
        async def kr_daily(self, m: str, start: date, end: date) -> list[Bar]:
            return bars(n, date(2026, 11, 2)) if n else []

    rows = await board(Clock()).rows(Short(), key="k")
    assert len(rows[0].closes) == n
