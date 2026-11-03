"""브리핑 일정 (스펙 6장).

- 국내 세션 S의 브리핑 시각 = max(S일 설정 시각(KST), S 마감 15:30 + 10분)
- 미국 세션 S(뉴욕 날짜)의 브리핑 시각 = max(S 다음 날(KST 날짜) 설정 시각, S 폐장 + 10분)
  (뉴욕 장은 한국 새벽에 끝나므로 '다음 날 아침' 브리핑이다)
- 놓친 브리핑은 가장 최근 1회분만 만든다. 지수·순위 API는 '지금' 값만 주므로 그 시장의 다음 세션이
  열리면 지난 세션 브리핑은 만들지 않는다(다른 날 데이터가 섞이지 않게).
"""

from datetime import date, datetime, time, timedelta
from functools import cache
from typing import Any, Literal

from vater_core.alerts.clock import KR_CLOSE, KR_OPEN, KST, NY, SETTLE, MarketClock

BriefingMarket = Literal["KR", "US"]
LOOKBACK_DAYS = 15  # 설·추석 연휴를 넘어 지난 세션을 찾는 범위


@cache
def _xnys() -> Any:
    import exchange_calendars as xcals

    return xcals.get_calendar("XNYS")


def session_open(market: BriefingMarket, day: date) -> datetime:
    if market == "KR":
        return datetime.combine(day, KR_OPEN, tzinfo=KST)
    opened: datetime = _xnys().session_open(day.isoformat()).to_pydatetime()
    return opened


def _close(market: BriefingMarket, day: date) -> datetime:
    if market == "KR":
        return datetime.combine(day, KR_CLOSE, tzinfo=KST)
    closed: datetime = _xnys().session_close(day.isoformat()).to_pydatetime()
    return closed


def slot_time(market: BriefingMarket, session: date, at: time) -> datetime:
    """세션 S의 브리핑 시각. 휴장 여부는 보지 않는다."""
    day = session if market == "KR" else session + timedelta(days=1)
    return max(datetime.combine(day, at, tzinfo=KST), _close(market, session) + SETTLE)


async def next_open(market: BriefingMarket, session: date, clock: MarketClock) -> datetime:
    """세션 S 다음 세션의 개장 시각."""
    day = session + timedelta(days=1)
    for _ in range(LOOKBACK_DAYS):
        if await clock.is_session_day(market, day):
            return session_open(market, day)
        day += timedelta(days=1)
    return session_open(market, day)


async def due_session(
    market: BriefingMarket, now: datetime, clock: MarketClock, at: time
) -> date | None:
    """지금 만들어야 할 브리핑의 세션 날짜(국내는 KST, 미국은 뉴욕 날짜). 없으면 None."""
    day = now.astimezone(KST if market == "KR" else NY).date()
    for _ in range(LOOKBACK_DAYS):
        if await clock.is_session_day(market, day) and slot_time(market, day, at) <= now:
            break
        day -= timedelta(days=1)
    else:
        return None
    if now >= await next_open(market, day, clock):
        return None
    return day
