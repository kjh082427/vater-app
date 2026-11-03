from datetime import date, datetime, time
from zoneinfo import ZoneInfo

import pytest

from vater_core.alerts.clock import MarketClock
from vater_core.briefing.schedule import due_session

KST = ZoneInfo("Asia/Seoul")
KR_HOLIDAY = date(2026, 11, 4)  # 테스트용 가상 국내 휴장일 (수요일)


async def kr_trading_day(day: date) -> bool:
    return day.weekday() < 5 and day != KR_HOLIDAY


async def due(market: str, at_kst: datetime, setting: str) -> date | None:
    clock = MarketClock(kr_trading_day, now=lambda: at_kst)
    hh, mm = map(int, setting.split(":"))
    return await due_session(market, at_kst, clock, time(hh, mm))  # type: ignore[arg-type]


def kst(month: int, day: int, hh: int, mm: int) -> datetime:
    return datetime(2026, month, day, hh, mm, tzinfo=KST)


@pytest.mark.parametrize(
    ("now", "expected"),
    [
        (kst(11, 2, 15, 59), None),  # 월 브리핑 시각 전, 금 세션은 월 09:00에 기한이 지났다
        (kst(11, 2, 16, 0), date(2026, 11, 2)),
        (kst(11, 3, 8, 59), date(2026, 11, 2)),  # 놓쳤어도 화 개장 전까지는 만든다
        (kst(11, 3, 9, 0), None),  # 다음 세션이 열리면 지난 세션은 만들지 않는다
        (kst(11, 3, 16, 0), date(2026, 11, 3)),
        (kst(11, 4, 12, 0), date(2026, 11, 3)),  # 휴장일: 다음 개장은 목 09:00
        (kst(11, 5, 8, 59), date(2026, 11, 3)),
        (kst(11, 5, 9, 0), None),
        (kst(11, 7, 12, 0), date(2026, 11, 6)),  # 토요일 → 금 세션
        (kst(11, 9, 8, 0), date(2026, 11, 6)),  # 월요일 아침 → 금 세션
    ],
)
async def test_kr_due_session(now: datetime, expected: date | None) -> None:
    assert await due("KR", now, "16:00") == expected


@pytest.mark.parametrize(
    ("now", "expected"),
    [
        (kst(11, 3, 15, 39), None),  # 설정이 마감 전이어도 마감 + 10분까지 기다린다
        (kst(11, 3, 15, 40), date(2026, 11, 3)),
    ],
)
async def test_kr_setting_before_close_waits_for_settle(
    now: datetime, expected: date | None
) -> None:
    assert await due("KR", now, "15:00") == expected


@pytest.mark.parametrize(
    ("now", "setting", "expected"),
    [
        # 11월(뉴욕 EST, 폐장 16:00 NY = 06:00 KST)
        (kst(11, 3, 6, 59), "07:00", None),
        (kst(11, 3, 7, 0), "07:00", date(2026, 11, 2)),
        (kst(11, 3, 23, 29), "07:00", date(2026, 11, 2)),
        (kst(11, 3, 23, 30), "07:00", None),  # 뉴욕 화 개장 09:30 NY
        (kst(11, 3, 6, 9), "05:30", None),  # 설정이 폐장 전 → 06:10까지 기다린다
        (kst(11, 3, 6, 10), "05:30", date(2026, 11, 2)),
        # 10월(뉴욕 EDT, 폐장 16:00 NY = 05:00 KST)
        (kst(10, 27, 6, 59), "07:00", None),
        (kst(10, 27, 7, 0), "07:00", date(2026, 10, 26)),
        (kst(10, 27, 5, 30), "05:30", date(2026, 10, 26)),
        # 추수감사절(11/26 휴장) 다음 날, 조기 폐장(11/27 13:00 NY = 11/28 03:00 KST)
        (kst(11, 27, 7, 0), "07:00", date(2026, 11, 25)),
        (kst(11, 28, 7, 0), "07:00", date(2026, 11, 27)),
    ],
)
async def test_us_due_session(now: datetime, setting: str, expected: date | None) -> None:
    assert await due("US", now, setting) == expected


async def test_no_session_in_lookback_gives_none() -> None:
    async def never(_: date) -> bool:
        return False

    now = kst(11, 3, 20, 0)
    clock = MarketClock(never, now=lambda: now)
    assert await due_session("KR", now, clock, time(16, 0)) is None


@pytest.mark.parametrize(
    ("now", "expected"),
    [
        (
            kst(11, 19, 16, 0),
            None,
        ),  # 수능날: 16:00에는 아직 장중(16:30 마감), 전날 세션은 10:00 개장으로 기한 지남
        (kst(11, 19, 16, 39), None),
        (kst(11, 19, 16, 40), date(2026, 11, 19)),  # 16:30 마감 + 10분
        (kst(11, 19, 9, 59), date(2026, 11, 18)),  # 수능날은 10:00에 열리므로 그 전까지는 전날 세션
    ],
)
async def test_kr_csat_day_waits_for_the_late_close(now: datetime, expected: date | None) -> None:
    assert await due("KR", now, "16:00") == expected
