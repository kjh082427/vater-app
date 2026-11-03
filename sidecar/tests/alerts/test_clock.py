from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

import pytest

from vater_core.alerts.clock import MarketClock
from vater_core.api.errors import VaterError

KST = ZoneInfo("Asia/Seoul")
NY = ZoneInfo("America/New_York")
KR_HOLIDAY = date(2026, 11, 4)  # 테스트용 가상 휴장일 (수요일)


class Holidays:
    def __init__(self, fail: bool = False) -> None:
        self.calls: list[date] = []
        self.fail = fail

    async def __call__(self, day: date) -> bool:
        self.calls.append(day)
        if self.fail:
            raise VaterError("KIS_UNREACHABLE", "끊김", status=503)
        return day.weekday() < 5 and day != KR_HOLIDAY


def clock(at: datetime, holidays: Holidays | None = None) -> MarketClock:
    return MarketClock(holidays or Holidays(), now=lambda: at)


@pytest.mark.parametrize(
    ("at", "is_open"),
    [
        (datetime(2026, 11, 3, 8, 59, tzinfo=KST), False),  # 장 시작 전
        (datetime(2026, 11, 3, 9, 0, tzinfo=KST), True),
        (datetime(2026, 11, 3, 15, 29, tzinfo=KST), True),
        (datetime(2026, 11, 3, 15, 30, tzinfo=KST), False),  # 장 마감
        (datetime(2026, 11, 4, 10, 0, tzinfo=KST), False),  # 휴장일
        (datetime(2026, 11, 7, 10, 0, tzinfo=KST), False),  # 토요일
    ],
)
async def test_kr_session(at: datetime, is_open: bool) -> None:
    assert await clock(at).is_open("KR") is is_open


async def test_kr_after_close() -> None:
    assert await clock(datetime(2026, 11, 3, 15, 39, tzinfo=KST)).after_close("KR") is False
    assert await clock(datetime(2026, 11, 3, 15, 40, tzinfo=KST)).after_close("KR") is True
    assert (
        await clock(datetime(2026, 11, 4, 16, 0, tzinfo=KST)).after_close("KR") is False
    )  # 휴장일


async def test_kr_holiday_lookup_is_cached_per_day() -> None:
    h = Holidays()
    c = clock(datetime(2026, 11, 3, 10, 0, tzinfo=KST), h)
    for _ in range(5):
        await c.is_open("KR")
        await c.after_close("KR")
    assert h.calls == [date(2026, 11, 3)]


async def test_kr_holiday_lookup_failure_falls_back_to_weekdays() -> None:
    h = Holidays(fail=True)
    assert await clock(datetime(2026, 11, 4, 10, 0, tzinfo=KST), h).is_open("KR") is True
    assert await clock(datetime(2026, 11, 7, 10, 0, tzinfo=KST), h).is_open("KR") is False


@pytest.mark.parametrize(
    ("at", "is_open"),
    [
        # 서머타임 중(EDT, UTC-4): 09:30 = 13:30 UTC
        (datetime(2026, 10, 30, 13, 29, tzinfo=UTC), False),
        (datetime(2026, 10, 30, 13, 31, tzinfo=UTC), True),
        # 서머타임 끝난 뒤(EST, UTC-5): 09:30 = 14:30 UTC
        (datetime(2026, 11, 2, 14, 29, tzinfo=UTC), False),
        (datetime(2026, 11, 2, 14, 31, tzinfo=UTC), True),
        (datetime(2026, 11, 2, 21, 0, tzinfo=UTC), False),  # 16:00 마감
        (datetime(2026, 11, 26, 16, 0, tzinfo=UTC), False),  # 추수감사절
        (datetime(2026, 11, 27, 17, 59, tzinfo=UTC), True),  # 다음 날은 13:00 조기 폐장
        (datetime(2026, 11, 27, 18, 0, tzinfo=UTC), False),
    ],
)
async def test_us_session(at: datetime, is_open: bool) -> None:
    assert await clock(at).is_open("US") is is_open


async def test_us_after_close_and_session_date() -> None:
    c = clock(datetime(2026, 11, 27, 18, 11, tzinfo=UTC))  # 조기 폐장 + 11분
    assert await c.after_close("US") is True
    assert await c.session_date("US") == date(2026, 11, 27)
    # 한국 시각으로는 다음 날 새벽이어도 미국 세션 날짜는 뉴욕 날짜다
    kst_morning = clock(datetime(2026, 11, 3, 6, 30, tzinfo=KST))
    assert await kst_morning.session_date("US") == date(2026, 11, 2)
    assert await kst_morning.session_date("KR") == date(2026, 11, 3)


async def test_is_session_day() -> None:
    c = clock(datetime(2026, 11, 3, 12, 0, tzinfo=KST))
    assert await c.is_session_day("KR", date(2026, 11, 3)) is True
    assert await c.is_session_day("KR", KR_HOLIDAY) is False
    assert await c.is_session_day("US", date(2026, 11, 26)) is False
    assert await c.is_session_day("US", date(2026, 11, 27)) is True


@pytest.mark.parametrize(
    ("at", "market", "expected"),
    [
        # 국내: 마감 + 10분(15:40)이 지나야 그날이 '확정된 마지막 세션'이다
        (datetime(2026, 11, 3, 10, 0, tzinfo=KST), "KR", date(2026, 11, 2)),
        (datetime(2026, 11, 3, 15, 39, tzinfo=KST), "KR", date(2026, 11, 2)),
        (datetime(2026, 11, 3, 15, 40, tzinfo=KST), "KR", date(2026, 11, 3)),
        (datetime(2026, 11, 4, 20, 0, tzinfo=KST), "KR", date(2026, 11, 3)),  # 휴장일 저녁
        (datetime(2026, 11, 9, 8, 0, tzinfo=KST), "KR", date(2026, 11, 6)),  # 월요일 아침 → 금요일
        # 미국: 한국 저녁(뉴욕 이른 아침)에는 뉴욕의 전 세션
        (datetime(2026, 11, 3, 20, 0, tzinfo=KST), "US", date(2026, 11, 2)),
        (datetime(2026, 11, 3, 16, 9, tzinfo=NY), "US", date(2026, 11, 2)),
        (datetime(2026, 11, 3, 16, 10, tzinfo=NY), "US", date(2026, 11, 3)),
        (datetime(2026, 11, 27, 13, 10, tzinfo=NY), "US", date(2026, 11, 27)),  # 조기 폐장 13:00
        (datetime(2026, 11, 26, 20, 0, tzinfo=NY), "US", date(2026, 11, 25)),  # 추수감사절 휴장
    ],
)
async def test_last_closed_session(at: datetime, market: str, expected: date) -> None:
    assert await clock(at).last_closed_session(market) == expected  # type: ignore[arg-type]


async def test_last_closed_session_gives_up_after_a_long_holiday() -> None:
    class Closed(Holidays):
        async def __call__(self, day: date) -> bool:
            return False

    at = datetime(2026, 11, 3, 20, 0, tzinfo=KST)
    assert await clock(at, Closed()).last_closed_session("KR") is None


CSAT = date(2026, 11, 19)  # 2027학년도 수능: 국내 장 10:00~16:30


@pytest.mark.parametrize(
    ("market", "day", "opened", "closed"),
    [
        (
            "KR",
            date(2026, 11, 3),
            datetime(2026, 11, 3, 9, 0, tzinfo=KST),
            datetime(2026, 11, 3, 15, 30, tzinfo=KST),
        ),
        (
            "KR",
            CSAT,
            datetime(2026, 11, 19, 10, 0, tzinfo=KST),
            datetime(2026, 11, 19, 16, 30, tzinfo=KST),
        ),
        (
            "US",
            date(2026, 11, 27),
            datetime(2026, 11, 27, 9, 30, tzinfo=NY),
            datetime(2026, 11, 27, 13, 0, tzinfo=NY),
        ),  # 추수감사절 다음 날 조기 폐장
    ],
)
def test_session_bounds(market: str, day: date, opened: datetime, closed: datetime) -> None:
    from vater_core.alerts.clock import session_bounds

    assert session_bounds(market, day) == (opened, closed)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("hh", "mm", "is_open", "settled"),
    [
        (9, 30, False, False),  # 수능날은 10:00에 연다
        (16, 0, True, False),  # 평소라면 마감 뒤지만 수능날은 장중
        (16, 39, False, False),
        (16, 40, False, True),  # 16:30 마감 + 10분
    ],
)
async def test_kr_csat_day_hours(hh: int, mm: int, is_open: bool, settled: bool) -> None:
    c = clock(datetime(2026, 11, 19, hh, mm, tzinfo=KST))
    assert await c.is_open("KR") is is_open
    assert await c.after_close("KR") is settled
    assert await c.last_closed_session("KR") == (CSAT if settled else date(2026, 11, 18))
