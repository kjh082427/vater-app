"""장 운영 시간과 휴장일 (스펙 4-2).

- 국내: 09:00~15:30 `Asia/Seoul`(수능날처럼 시간이 바뀌는 날은 `KR_SPECIAL_HOURS`).
  휴장일은 한투 휴장일 API(하루 1번 확인해 캐시). 한투를 못 부르면 주말만 거른다.
- 미국: `exchange_calendars`의 `XNYS`(휴장일·조기 폐장 포함), 시각은 그 세션의 개장·폐장 시각.
"""

import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime, time, timedelta
from functools import cache
from typing import Any, Literal
from zoneinfo import ZoneInfo

from vater_core.api.errors import VaterError

logger = logging.getLogger(__name__)

MarketId = Literal["KR", "US"]
KST = ZoneInfo("Asia/Seoul")
NY = ZoneInfo("America/New_York")
KR_OPEN, KR_CLOSE = time(9, 0), time(15, 30)
SETTLE = timedelta(minutes=10)  # 마감 뒤 일봉이 확정될 때까지 기다리는 시간
LOOKBACK_DAYS = 15  # 마지막 세션을 찾을 때 거슬러 올라가는 날 수 (설·추석 연휴 포함)

# 국내 장 시간이 평소와 다른 날. 한투 휴장일 API는 개장 여부만 알려 준다.
# 대학수학능력시험일에는 한국거래소가 1시간 늦게 열고 1시간 늦게 닫는다. 해마다 날짜를 더한다.
KR_SPECIAL_HOURS: dict[date, tuple[time, time]] = {
    date(2026, 11, 19): (time(10, 0), time(16, 30)),  # 2027학년도 수능
}

TradingDayFn = Callable[[date], Awaitable[bool]]


@cache
def _xnys() -> Any:
    import exchange_calendars as xcals

    return xcals.get_calendar("XNYS")


def _now_default() -> datetime:
    return datetime.now(UTC)


def session_bounds(market: MarketId, day: date) -> tuple[datetime, datetime]:
    """그 날의 개장·마감 시각. 휴장일인지는 보지 않는다(미국 휴장일은 오류가 난다)."""
    if market == "KR":
        opened, closed = KR_SPECIAL_HOURS.get(day, (KR_OPEN, KR_CLOSE))
        return datetime.combine(day, opened, tzinfo=KST), datetime.combine(day, closed, tzinfo=KST)
    cal = _xnys()
    us_open: datetime = cal.session_open(day.isoformat()).to_pydatetime()
    us_close: datetime = cal.session_close(day.isoformat()).to_pydatetime()
    return us_open, us_close


class MarketClock:
    def __init__(self, kr_trading_day: TradingDayFn, now: Callable[[], datetime] = _now_default):
        self._kr_trading_day = kr_trading_day
        self._now = now
        self._kr_cache: dict[date, bool] = {}

    def _local(self, market: MarketId) -> datetime:
        return self._now().astimezone(KST if market == "KR" else NY)

    async def session_date(self, market: MarketId) -> date:
        return self._local(market).date()

    async def is_session_day(self, market: MarketId, day: date) -> bool:
        if market == "US":
            return bool(_xnys().is_session(day.isoformat()))
        if day.weekday() >= 5:
            return False
        if day in self._kr_cache:
            return self._kr_cache[day]
        try:
            value = await self._kr_trading_day(day)
        except VaterError:
            logger.warning("KR holiday lookup failed for %s: assuming weekdays are open", day)
            return True  # 캐시하지 않는다: 다음 확인 때 다시 묻는다
        self._kr_cache[day] = value
        return value

    async def _open_close(self, market: MarketId) -> tuple[datetime, datetime] | None:
        local = self._local(market)
        day = local.date()
        if not await self.is_session_day(market, day):
            return None
        return session_bounds(market, day)

    async def is_open(self, market: MarketId) -> bool:
        session = await self._open_close(market)
        if session is None:
            return False
        opened, closed = session
        return opened <= self._now() < closed

    async def last_closed_session(self, market: MarketId) -> date | None:
        """일봉이 확정된(마감 + 10분이 지난) 가장 최근 세션의 현지 날짜.

        앱이 마감 직후에 꺼져 있었어도 다음 실행 때 그 세션을 평가할 수 있게 한다.
        """
        day = self._local(market).date()
        for _ in range(LOOKBACK_DAYS):
            if (
                await self.is_session_day(market, day)
                and self._now() >= session_bounds(market, day)[1] + SETTLE
            ):
                return day
            day -= timedelta(days=1)
        return None

    async def after_close(self, market: MarketId) -> bool:
        """오늘이 거래일이고, 마감 후 일봉이 확정될 시간이 지났다."""
        session = await self._open_close(market)
        return session is not None and self._now() >= session[1] + SETTLE
