"""알림 지표용 일봉 갱신 (스펙 4-2: 장 마감 후 하루 1번, 최근 260거래일).

처음에는 400일 치를 받고, 그 뒤로는 마지막 날의 일주일 전부터만 다시 받는다(수정주가 반영).
한투 해외 일봉은 한 번에 약 100행이라 끝 날짜를 앞으로 옮기며 이어 받는다.
"""

from datetime import date, timedelta
from typing import cast

from vater_core.alerts.store import BarRepo, WatchItem
from vater_core.kis.client import KisClient
from vater_core.kis.config import Priority
from vater_core.kis.models import Bar, UsExchange
from vater_core.kis.quotes import domestic_daily, overseas_daily

HISTORY_DAYS = 400  # 260거래일 + 휴장일 여유
REFETCH_DAYS = 7
MAX_US_PAGES = 4


async def _overseas(client: KisClient, item: WatchItem, start: date, end: date) -> list[Bar]:
    bars: dict[date, Bar] = {}
    page_end = end
    for _ in range(MAX_US_PAGES):
        page = await overseas_daily(
            client, cast(UsExchange, item.exchange), item.code, page_end, Priority.ALERTS
        )
        for b in page:
            if start <= b.day <= end:
                bars[b.day] = b
        if not page or page[0].day <= start:
            break
        page_end = page[0].day - timedelta(days=1)
    return [bars[d] for d in sorted(bars)]


async def refresh_bars(client: KisClient, repo: BarRepo, item: WatchItem, today: date) -> int:
    """`today`(확정된 마지막 세션 날짜)까지 일봉을 채운다. 저장한 행 수를 돌려준다."""
    last = repo.last_day(item.market, item.code)
    if last is not None and last >= today:
        return 0
    if last is None or (today - last).days > HISTORY_DAYS:
        start = today - timedelta(days=HISTORY_DAYS)
    else:
        start = last - timedelta(days=REFETCH_DAYS)
    if item.market == "KR":
        bars = await domestic_daily(client, item.code, start, today, Priority.ALERTS)
    else:
        bars = await _overseas(client, item, start, today)
    return repo.upsert(item.market, item.code, bars)
