"""자산 추이 기록 (v2 설계 12장). 값을 지어내지 않고, 원화·달러를 섞지 않는다."""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any, cast
from zoneinfo import ZoneInfo

import httpx
import pytest

from vater_core.alerts.clock import MarketClock
from vater_core.alerts.store import BarRepo
from vater_core.api.deps import AppDeps
from vater_core.holdings.service import HoldingsService
from vater_core.kis.models import Bar
from vater_core.market.fx import FxRepo
from vater_core.portfolio.daily import RETRY, RETRY_DAYS, DailyRecorder, DailyRepo, get_daily
from vater_core.store.holdings import HoldingRow, HoldingsRepo

KST = ZoneInfo("Asia/Seoul")
AT = "2026-11-02T00:00:00Z"
SAMSUNG = ("KR", "005930")
HYNIX = ("KR", "000660")
APPLE = ("US", "AAPL")
MON, TUE, WED, THU, FRI = (date(2026, 11, d) for d in (2, 3, 4, 5, 6))
SAT, SUN, NEXT_MON = date(2026, 11, 7), date(2026, 11, 8), date(2026, 11, 9)
THANKSGIVING = date(2026, 11, 26)  # 뉴욕 휴장, 한국 개장
CSAT = date(2026, 11, 19)  # 수능날: 국내 16:30 마감


def kst(day: date, hour: int = 17, minute: int = 0) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=KST)


def close_of(market: str, day: date) -> float:
    """날짜마다 다른 종가. 어느 날의 종가를 썼는지 값으로 알 수 있다."""
    base = 100.0 if market == "US" else 10000.0
    return base + day.toordinal() % 100


class FakeSync:
    def __init__(self, rig: "Rig") -> None:
        self.rig = rig
        self.calls: list[bool] = []

    async def sync(self, broker_id: str | None = None, *, skip_lost: bool = False) -> list[Any]:
        self.calls.append(skip_lost)
        self.rig.rows_at_sync.append(self.rig.repo.last_day())
        return []


class Rig:
    def __init__(self, deps: AppDeps, at: datetime, *, kr_closed: set[date] | None = None) -> None:
        assert deps.db is not None
        self.deps, self.db, self.at = deps, deps.db, at
        self.repo = DailyRepo(self.db)
        self.kr_closed = kr_closed or set()
        self.fail: set[tuple[str, str]] = set()
        self.fx_error: Exception | None = None
        self.fx_days: dict[date, float] | None = None  # None이면 모든 날 1400 + 일
        self.refreshes: list[tuple[str, str, date]] = []
        self.fx_calls: list[tuple[date, date]] = []
        self.rows_at_sync: list[date | None] = []
        self.sync = FakeSync(self)
        deps.holdings = cast(HoldingsService, self.sync)
        self.recorder = self.make()
        deps.daily = self.recorder

    def make(self) -> DailyRecorder:
        async def kr_day(day: date) -> bool:
            return day.weekday() < 5 and day not in self.kr_closed

        return DailyRecorder(
            self.deps,
            clock=MarketClock(kr_day, now=lambda: self.at.astimezone(UTC)),
            refresh=self.refresh,
            fetch_fx=self.fetch_fx,
            now=lambda: self.at,
        )

    async def refresh(self, market: str, code: str, through: date) -> None:
        self.refreshes.append((market, code, through))
        if (market, code) in self.fail:
            raise RuntimeError("no bars")
        days = [through - timedelta(days=i) for i in range(30)]
        bars = [Bar(d, 1, 1, 1, close_of(market, d), 1) for d in days if d.weekday() < 5]
        BarRepo(self.db).upsert(market, code, bars)

    async def fetch_fx(self, start: date, end: date) -> dict[date, float]:
        self.fx_calls.append((start, end))
        if self.fx_error is not None:
            raise self.fx_error
        if self.fx_days is not None:
            return self.fx_days
        # 범위 밖(미래) 날짜도 섞어 준다: 저장되면 안 된다
        days = [start + timedelta(days=i) for i in range((end - start).days + 2)]
        return {d: 1400.0 + d.day for d in days}

    def hold(self, key: tuple[str, str], qty: int = 10, avg: int | None = 100) -> None:
        market, code = key
        row = HoldingRow(
            cast(Any, market),
            code,
            code,
            Decimal(qty),
            None if avg is None else Decimal(avg),
            "KRW" if market == "KR" else "USD",
        )
        HoldingsRepo(self.db).manual_upsert("samsung", row, AT)

    def seed_row(self, day: date, kr: float | None = 1.0, us: float | None = 0.0) -> None:
        self.repo.fill(day, kr, 1.0, us, 0.0, None, backfilled=False)

    def rows(self) -> dict[str, dict[str, Any]]:
        cols = "day, kr_value, kr_cost, us_value, us_cost, usdkrw, backfilled"
        names = cols.split(", ")
        got = self.db.execute(f"SELECT {cols} FROM portfolio_daily ORDER BY day").fetchall()  # noqa: S608
        return {r[0]: dict(zip(names, r, strict=True)) for r in got}


@pytest.fixture
def rig(deps: AppDeps) -> Rig:
    return Rig(deps, kst(TUE))


# ---- 언제 기록하는가 -----------------------------------------------------------


async def test_before_16_kst_records_nothing_and_does_not_sync(rig: Rig) -> None:
    rig.hold(SAMSUNG)
    rig.at = kst(TUE, 15, 59)
    await rig.recorder.check_once()
    assert rig.rows() == {}
    assert rig.sync.calls == []
    assert rig.refreshes == []


async def test_records_once_after_16_and_syncs_first_skipping_lost(rig: Rig) -> None:
    rig.hold(SAMSUNG, qty=10, avg=9000)
    rig.at = kst(TUE, 16, 0)
    await rig.recorder.check_once()
    row = rig.rows()[TUE.isoformat()]
    assert row["kr_value"] == 10 * close_of("KR", TUE)
    assert row["kr_cost"] == 90000
    assert row["us_value"] == 0  # 달러 보유가 없음(실패가 아님)
    assert row["backfilled"] == 0
    assert rig.sync.calls == [True]
    assert rig.rows_at_sync == [None]  # 기록 전에 동기화한다


async def test_rerun_is_idempotent_even_after_restart(rig: Rig) -> None:
    rig.hold(SAMSUNG)
    await rig.recorder.check_once()
    before = rig.rows()
    calls = len(rig.refreshes)
    await rig.recorder.check_once()
    rig.at = kst(TUE, 23)
    await rig.make().check_once()  # 앱을 다시 켜도 같다
    assert rig.rows() == before
    assert len(rig.refreshes) == calls
    assert rig.sync.calls == [True]


async def test_sync_failure_still_records_with_last_quantity(rig: Rig) -> None:
    async def broken(broker_id: str | None = None, *, skip_lost: bool = False) -> list[Any]:
        raise RuntimeError("broker down")

    rig.sync.sync = broken  # type: ignore[method-assign]
    rig.hold(SAMSUNG)
    await rig.recorder.check_once()
    assert rig.rows()[TUE.isoformat()]["kr_value"] == 10 * close_of("KR", TUE)


async def test_late_close_day_waits_for_the_close(deps: AppDeps) -> None:
    rig = Rig(deps, kst(CSAT, 16, 10))
    rig.hold(SAMSUNG)
    await rig.recorder.check_once()
    assert rig.rows() == {}  # 수능날은 16:30 마감이라 아직 장중이다
    rig.at = kst(CSAT, 16, 41)
    await rig.recorder.check_once()
    assert list(rig.rows()) == [CSAT.isoformat()]


# ---- 빈 날 채우기 --------------------------------------------------------------


async def test_fills_missed_trading_days_with_each_days_close_and_fx(deps: AppDeps) -> None:
    rig = Rig(deps, kst(FRI))
    rig.hold(SAMSUNG, qty=10)
    rig.hold(APPLE, qty=2)
    rig.seed_row(MON)
    await rig.recorder.check_once()
    rows = rig.rows()
    assert list(rows) == [d.isoformat() for d in (MON, TUE, WED, THU, FRI)]
    assert [rows[d.isoformat()]["backfilled"] for d in (TUE, WED, THU, FRI)] == [1, 1, 1, 0]
    wed = rows[WED.isoformat()]
    assert wed["kr_value"] == 10 * close_of("KR", WED)
    assert wed["us_value"] == 2 * close_of(
        "US", TUE
    )  # 수요일 16:00 KST에 확정된 뉴욕 세션은 화요일
    assert wed["usdkrw"] == 1400.0 + WED.day


async def test_past_days_fill_in_the_morning_but_today_waits(deps: AppDeps) -> None:
    rig = Rig(deps, kst(THU, 10))
    rig.hold(SAMSUNG)
    rig.seed_row(MON)
    await rig.recorder.check_once()
    assert list(rig.rows()) == [d.isoformat() for d in (MON, TUE, WED)]
    assert rig.rows()[WED.isoformat()]["backfilled"] == 1


async def test_weekend_is_skipped_and_friday_is_filled(deps: AppDeps) -> None:
    rig = Rig(deps, kst(NEXT_MON))
    rig.hold(SAMSUNG)
    rig.seed_row(THU)
    await rig.recorder.check_once()
    assert list(rig.rows()) == [d.isoformat() for d in (THU, FRI, NEXT_MON)]
    assert rig.rows()[FRI.isoformat()]["backfilled"] == 1
    assert rig.rows()[NEXT_MON.isoformat()]["backfilled"] == 0


async def test_weekend_today_makes_no_row(deps: AppDeps) -> None:
    rig = Rig(deps, kst(SAT))
    rig.hold(SAMSUNG)
    rig.seed_row(FRI)
    await rig.recorder.check_once()
    assert list(rig.rows()) == [FRI.isoformat()]
    assert rig.sync.calls == []


async def test_korean_holiday_keeps_us_and_carries_last_kr_close(deps: AppDeps) -> None:
    rig = Rig(deps, kst(THU), kr_closed={THU})
    rig.hold(SAMSUNG)
    rig.hold(APPLE)
    rig.seed_row(WED)
    await rig.recorder.check_once()
    row = rig.rows()[THU.isoformat()]
    assert row["kr_value"] == 10 * close_of("KR", WED)  # 쉬는 날은 마지막 종가, 0이나 null이 아니다
    assert row["us_value"] == 10 * close_of("US", WED)


async def test_us_holiday_keeps_kr_and_carries_last_us_close(deps: AppDeps) -> None:
    next_day = THANKSGIVING + timedelta(days=1)
    rig = Rig(deps, kst(next_day))
    rig.hold(SAMSUNG)
    rig.hold(APPLE)
    rig.seed_row(THANKSGIVING - timedelta(days=1))
    await rig.recorder.check_once()
    rows = rig.rows()
    last_us = close_of("US", THANKSGIVING - timedelta(days=1))
    assert rows[THANKSGIVING.isoformat()]["kr_value"] == 10 * close_of("KR", THANKSGIVING)
    assert rows[THANKSGIVING.isoformat()]["us_value"] == 10 * last_us
    assert rows[next_day.isoformat()]["us_value"] == 10 * last_us  # 26일 뉴욕 세션은 없었다


async def test_day_closed_in_both_markets_has_no_row(deps: AppDeps) -> None:
    next_day = THANKSGIVING + timedelta(days=1)
    rig = Rig(deps, kst(next_day), kr_closed={THANKSGIVING})
    rig.hold(SAMSUNG)
    rig.seed_row(THANKSGIVING - timedelta(days=1))
    await rig.recorder.check_once()
    assert THANKSGIVING.isoformat() not in rig.rows()
    assert next_day.isoformat() in rig.rows()


async def test_no_rows_before_the_first_record(deps: AppDeps) -> None:
    rig = Rig(deps, kst(FRI))
    rig.hold(SAMSUNG)
    await rig.recorder.check_once()
    assert list(rig.rows()) == [FRI.isoformat()]
    assert rig.rows()[FRI.isoformat()]["backfilled"] == 0


async def test_nothing_is_recorded_until_something_is_held(rig: Rig) -> None:
    await rig.recorder.check_once()
    assert rig.rows() == {}
    assert rig.refreshes == []


async def test_selling_everything_records_zero_not_null(deps: AppDeps) -> None:
    rig = Rig(deps, kst(TUE))
    rig.seed_row(MON)
    await rig.recorder.check_once()
    row = rig.rows()[TUE.isoformat()]
    assert (row["kr_value"], row["us_value"], row["kr_cost"]) == (0, 0, 0)


# ---- 미확정 값 ----------------------------------------------------------------


async def test_never_uses_a_session_that_has_not_closed(deps: AppDeps) -> None:
    rig = Rig(deps, kst(TUE))
    rig.hold(SAMSUNG)
    rig.hold(APPLE)
    # 화요일 뉴욕 세션은 16:00 KST에 아직 열리지도 않았다. 잘못 받아 둔 봉이 있어도 쓰지 않는다
    BarRepo(rig.db).upsert("US", "AAPL", [Bar(TUE, 1, 1, 1, 999999.0, 1)])
    await rig.recorder.check_once()
    assert rig.rows()[TUE.isoformat()]["us_value"] == 10 * close_of("US", MON)
    assert ("US", "AAPL", MON) in rig.refreshes
    assert all(r[2] <= MON for r in rig.refreshes if r[0] == "US")
    assert all(r[2] <= TUE for r in rig.refreshes)


async def test_no_future_fx_or_rows(deps: AppDeps) -> None:
    rig = Rig(deps, kst(TUE))
    rig.hold(APPLE)
    await rig.recorder.check_once()
    assert max(rig.rows()) == TUE.isoformat()
    assert FxRepo(rig.db).get(WED) is None


async def test_stale_bar_is_not_passed_off_as_that_days_close(deps: AppDeps) -> None:
    rig = Rig(deps, kst(TUE))
    rig.hold(SAMSUNG)
    BarRepo(rig.db).upsert("KR", "005930", [Bar(MON, 1, 1, 1, 123.0, 1)])
    rig.fail.add(SAMSUNG)
    await rig.recorder.check_once()
    assert rig.rows()[TUE.isoformat()]["kr_value"] is None  # 월요일 값으로 메우지 않는다


# ---- 일부 실패 ----------------------------------------------------------------


async def test_one_market_failing_leaves_the_other_and_retries_later(deps: AppDeps) -> None:
    rig = Rig(deps, kst(TUE))
    rig.hold(SAMSUNG, avg=9000)
    rig.hold(APPLE)
    rig.fail.add(SAMSUNG)
    await rig.recorder.check_once()
    row = rig.rows()[TUE.isoformat()]
    assert row["kr_value"] is None  # 0이 아니다
    assert row["kr_cost"] == 90000  # 매입금액은 시세와 무관하다
    assert row["us_value"] == 10 * close_of("US", MON)

    rig.fail.clear()
    calls = len(rig.refreshes)
    await rig.recorder.check_once()  # 바로 다음 확인에서는 다시 부르지 않는다
    assert len(rig.refreshes) == calls

    rig.at += RETRY
    await rig.recorder.check_once()
    row = rig.rows()[TUE.isoformat()]
    assert row["kr_value"] == 10 * close_of("KR", TUE)
    assert row["backfilled"] == 0
    assert rig.sync.calls == [True]  # 다시 시도할 때 동기화를 또 하지 않는다


async def test_one_symbol_failing_nulls_its_market_rather_than_a_partial_sum(deps: AppDeps) -> None:
    rig = Rig(deps, kst(TUE))
    rig.hold(SAMSUNG)
    rig.hold(HYNIX)
    rig.fail.add(SAMSUNG)
    await rig.recorder.check_once()
    assert rig.rows()[TUE.isoformat()]["kr_value"] is None  # 절반만 더하면 폭락으로 보인다
    assert ("KR", "000660", TUE) in rig.refreshes


async def test_fx_failure_nulls_only_the_rate_and_retries(deps: AppDeps) -> None:
    rig = Rig(deps, kst(TUE))
    rig.hold(APPLE)
    rig.fx_error = RuntimeError("fx down")
    await rig.recorder.check_once()
    row = rig.rows()[TUE.isoformat()]
    assert row["usdkrw"] is None
    assert row["us_value"] == 10 * close_of("US", MON)

    rig.fx_error = None
    rig.at += RETRY
    await rig.recorder.check_once()
    assert rig.rows()[TUE.isoformat()]["usdkrw"] == 1400.0 + TUE.day


async def test_saved_fx_is_reused_so_a_day_keeps_one_rate(deps: AppDeps) -> None:
    rig = Rig(deps, kst(TUE))
    rig.hold(APPLE)
    FxRepo(rig.db).save(TUE, 1333.0)
    await rig.recorder.check_once()
    assert rig.rows()[TUE.isoformat()]["usdkrw"] == 1333.0
    assert rig.fx_calls == []


async def test_long_gap_fetches_fx_in_chunks(deps: AppDeps) -> None:
    rig = Rig(deps, kst(TUE))
    rig.hold(APPLE)
    rig.seed_row(TUE - timedelta(days=200))
    await rig.recorder.check_once()
    assert len(rig.fx_calls) >= 3
    assert all((end - start).days < 100 for start, end in rig.fx_calls)


async def test_krw_only_holder_never_asks_for_fx(deps: AppDeps) -> None:
    rig = Rig(deps, kst(TUE))
    rig.hold(SAMSUNG)
    await rig.recorder.check_once()
    assert rig.fx_calls == []
    rig.at += RETRY
    await rig.recorder.check_once()  # 환율이 null이어도 달러 자산이 없으니 다시 시도할 것이 없다
    assert rig.fx_calls == []


async def test_retry_stops_after_the_window(deps: AppDeps) -> None:
    rig = Rig(deps, kst(TUE))
    rig.hold(SAMSUNG)
    rig.seed_row(TUE, kr=None)
    rig.at = kst(TUE + timedelta(days=RETRY_DAYS + 1), 10)
    await rig.recorder.check_once()
    assert rig.refreshes  # 새 날은 채운다
    assert rig.rows()[TUE.isoformat()]["kr_value"] is None


async def test_retry_does_not_turn_a_failed_value_into_zero_after_selling(deps: AppDeps) -> None:
    rig = Rig(deps, kst(TUE))
    rig.seed_row(TUE, kr=None)
    await rig.recorder.check_once()
    assert rig.rows()[TUE.isoformat()]["kr_value"] is None


async def test_without_kis_keys_nothing_is_written_and_sync_runs_once(deps: AppDeps) -> None:
    rig = Rig(deps, kst(TUE))
    rig.hold(SAMSUNG)

    async def kr_day(day: date) -> bool:
        return day.weekday() < 5

    real = DailyRecorder(deps, clock=MarketClock(kr_day), fetch_fx=rig.fetch_fx, now=lambda: rig.at)
    with pytest.raises(Exception, match="앱키"):
        await real.check_once()
    with pytest.raises(Exception, match="앱키"):
        await real.check_once()
    assert rig.rows() == {}  # 키를 넣으면 그때 채운다
    assert rig.sync.calls == [True]


async def test_start_and_stop(rig: Rig) -> None:
    rig.recorder.start()
    await rig.recorder.stop()


# ---- 조회 API -----------------------------------------------------------------


@pytest.fixture
def history(rig: Rig) -> Rig:
    rig.at = kst(FRI)
    rig.repo.fill(MON, 1000.0, 900.0, 10.0, 8.0, 1400.0, backfilled=False)
    rig.repo.fill(TUE, 1100.0, 900.0, 20.0, 8.0, None, backfilled=True)
    rig.repo.fill(WED, None, 900.0, 30.0, 8.0, 1500.0, backfilled=False)
    rig.repo.fill(THU, 1300.0, 900.0, 0.0, 0.0, None, backfilled=False)
    return rig


async def test_history_all_view_converts_with_that_days_rate(
    client: httpx.AsyncClient, history: Rig
) -> None:
    r = await client.get("/portfolio/history", params={"range": "1m", "view": "all"})
    assert r.status_code == 200
    assert r.json() == [
        {
            "day": "2026-11-02",
            "value": 1000 + 10 * 1400,
            "cost": 900 + 8 * 1400,
            "usdkrw": 1400.0,
            "backfilled": False,
        },
        {"day": "2026-11-03", "value": None, "cost": None, "usdkrw": None, "backfilled": True},
        {"day": "2026-11-04", "value": None, "cost": 900 + 8 * 1500, "usdkrw": 1500.0}
        | {"backfilled": False},
        {"day": "2026-11-05", "value": 1300, "cost": 900, "usdkrw": None, "backfilled": False},
    ]


async def test_history_default_view_is_all(client: httpx.AsyncClient, history: Rig) -> None:
    r = await client.get("/portfolio/history")
    assert r.json()[0]["value"] == 1000 + 10 * 1400


async def test_history_krw_and_usd_views_do_not_need_a_rate(
    client: httpx.AsyncClient, history: Rig
) -> None:
    krw = (await client.get("/portfolio/history", params={"view": "krw"})).json()
    usd = (await client.get("/portfolio/history", params={"view": "usd"})).json()
    assert [(p["value"], p["cost"]) for p in krw] == [
        (1000, 900),
        (1100, 900),
        (None, 900),
        (1300, 900),
    ]
    assert [(p["value"], p["cost"]) for p in usd] == [(10, 8), (20, 8), (30, 8), (0, 0)]


async def test_history_ranges(client: httpx.AsyncClient, rig: Rig) -> None:
    rig.at = kst(FRI)
    old = [FRI - timedelta(days=n) for n in (1, 40, 100, 400)]
    for d in old:
        rig.repo.fill(d, 1.0, 1.0, 0.0, 0.0, None, backfilled=False)
    counts = {}
    for rng in ("1m", "3m", "1y", "all"):
        got = (await client.get("/portfolio/history", params={"range": rng})).json()
        counts[rng] = len(got)
        assert got == sorted(got, key=lambda p: p["day"])  # 오래된 것부터
    assert counts == {"1m": 1, "3m": 2, "1y": 3, "all": 4}


@pytest.mark.parametrize("params", [{"range": "2w"}, {"view": "eur"}])
async def test_history_rejects_bad_params(
    client: httpx.AsyncClient, params: dict[str, str]
) -> None:
    r = await client.get("/portfolio/history", params=params)
    assert r.status_code == 422


async def test_history_is_empty_without_records(client: httpx.AsyncClient, deps: AppDeps) -> None:
    assert (await client.get("/portfolio/history")).json() == []
    assert get_daily(deps) is deps.daily
