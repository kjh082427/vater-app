"""브리핑 데이터 수집 (스펙 6장). 숫자는 모두 여기서 받은 그대로 저장되고 UI가 직접 그린다.

- 항목(section) 단위로 받는다. 한 항목 안의 호출이 하나라도 실패하면 그 항목 전체를 `missing`에
  넣는다(반쪽짜리 표를 보여주지 않는다).
- 인터넷 끊김은 그대로 올린다(서비스가 나중에 다시 시도). 한투 항목이 모두 실패하면
  `BRIEFING_NO_DATA`.
- 미국: 한투에 미국 업종·순위·수급 API가 없어서 지수·감시 종목·알림만 있다(빠진 것이 아님).
"""

import dataclasses
import logging
import sqlite3
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Literal, Protocol

import httpx

from vater_core.alerts.clock import KST
from vater_core.alerts.store import EventRepo, WatchItem, WatchlistRepo
from vater_core.api.errors import VaterError
from vater_core.briefing.schedule import BriefingMarket, session_open
from vater_core.kis.client import KisClient
from vater_core.kis.config import Priority
from vater_core.kis.market import (
    DomesticMarket,
    IndexQuote,
    InvestorFlows,
    OverseasIndex,
    OverseasIndexCode,
    RankItem,
    SectorBoard,
    fluctuation_rank,
    index_quote,
    investor_flows,
    overseas_index,
    sector_board,
    trading_value_rank,
)
from vater_core.kis.models import Quote, UsExchange
from vater_core.kis.quotes import domestic_price, overseas_price

logger = logging.getLogger(__name__)

DOMESTIC: tuple[DomesticMarket, ...] = ("KOSPI", "KOSDAQ")
US_INDICES: tuple[OverseasIndexCode, ...] = ("SPX", "COMP", "NDX")
RANK_LIMIT = 10
INDEX_CLOSES = 30  # 미국 지수 미니 차트용 최근 종가 수
EVENT_SCAN = 500


class Feeds(Protocol):
    async def index_quote(self, m: DomesticMarket) -> IndexQuote: ...
    async def sector_board(self, m: DomesticMarket) -> SectorBoard: ...
    async def fluctuation_rank(
        self, direction: Literal["up", "down"], limit: int = RANK_LIMIT
    ) -> list[RankItem]: ...
    async def trading_value_rank(self, limit: int = RANK_LIMIT) -> list[RankItem]: ...
    async def investor_flows(self, m: DomesticMarket, day: date) -> InvestorFlows: ...
    async def overseas_index(
        self, code: OverseasIndexCode, start: date, end: date
    ) -> OverseasIndex: ...
    async def price(self, item: WatchItem) -> Quote: ...


class KisFeeds:
    """한투 조회. 순위·지수 함수는 이미 `Priority.BRIEFING`으로 부른다."""

    def __init__(self, client: KisClient) -> None:
        self._c = client

    async def index_quote(self, m: DomesticMarket) -> IndexQuote:
        return await index_quote(self._c, m)

    async def sector_board(self, m: DomesticMarket) -> SectorBoard:
        return await sector_board(self._c, m)

    async def fluctuation_rank(
        self, direction: Literal["up", "down"], limit: int = RANK_LIMIT
    ) -> list[RankItem]:
        return await fluctuation_rank(self._c, direction, limit)

    async def trading_value_rank(self, limit: int = RANK_LIMIT) -> list[RankItem]:
        return await trading_value_rank(self._c, limit)

    async def investor_flows(self, m: DomesticMarket, day: date) -> InvestorFlows:
        return await investor_flows(self._c, m, day)

    async def overseas_index(
        self, code: OverseasIndexCode, start: date, end: date
    ) -> OverseasIndex:
        return await overseas_index(self._c, code, start, end)

    async def price(self, item: WatchItem) -> Quote:
        if item.market == "KR":
            return await domestic_price(self._c, item.code, Priority.BRIEFING)
        exchange: UsExchange = item.exchange  # type: ignore[assignment]
        return await overseas_price(self._c, exchange, item.code, Priority.BRIEFING)


@dataclass
class Collected:
    data: dict[str, Any]
    missing: list[str] = field(default_factory=list)


def _plain(value: Any) -> Any:
    """dataclass·날짜를 JSON에 넣을 수 있는 값으로."""
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return {f.name: _plain(getattr(value, f.name)) for f in dataclasses.fields(value)}
    if isinstance(value, list | tuple):
        return [_plain(v) for v in value]
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    if isinstance(value, date):
        return value.isoformat()
    return value


def _offline(e: BaseException) -> bool:
    if isinstance(e, VaterError):
        return e.code == "KIS_UNREACHABLE"
    return isinstance(e, httpx.TransportError)


async def _us_index(feeds: Feeds, code: OverseasIndexCode, session: date) -> dict[str, Any]:
    idx = await feeds.overseas_index(code, session - timedelta(days=60), session)
    closes = [{"day": b.day.isoformat(), "close": b.close} for b in idx.bars if b.day <= session]
    return {**_plain(idx.quote), "closes": closes[-INDEX_CLOSES:]}


def _kis_sections(
    market: BriefingMarket, session: date, feeds: Feeds
) -> dict[str, Callable[[], Awaitable[Any]]]:
    if market == "US":

        async def us_indices() -> Any:
            return [await _us_index(feeds, code, session) for code in US_INDICES]

        return {"indices": us_indices}

    async def indices() -> Any:
        return [await feeds.index_quote(m) for m in DOMESTIC]

    async def sectors() -> Any:
        return {m: await feeds.sector_board(m) for m in DOMESTIC}

    async def movers() -> Any:
        return {
            "up": await feeds.fluctuation_rank("up", RANK_LIMIT),
            "down": await feeds.fluctuation_rank("down", RANK_LIMIT),
            "value": await feeds.trading_value_rank(RANK_LIMIT),
        }

    async def flows() -> Any:
        return {m: await feeds.investor_flows(m, session) for m in DOMESTIC}

    return {"indices": indices, "sectors": sectors, "movers": movers, "flows": flows}


async def _watchlist(
    market: BriefingMarket, feeds: Feeds, db: sqlite3.Connection
) -> list[dict[str, Any]]:
    out = []
    for item in WatchlistRepo(db).list():
        if item.market != market:
            continue
        try:
            q = await feeds.price(item)
        except Exception as e:
            if _offline(e):
                raise
            logger.warning("briefing: price for %s %s failed: %s", item.market, item.code, e)
            continue
        out.append(
            {"code": item.code, "name": item.name, "price": q.price, "change_pct": q.change_pct}
        )
    return out


def _alerts(
    market: BriefingMarket, session: date, db: sqlite3.Connection, until: datetime
) -> list[dict[str, Any]]:
    start = session_open(market, session)
    picked = [
        e
        for e in EventRepo(db).list(EVENT_SCAN)
        if e.rule_id is not None
        and e.market == market
        and start <= datetime.fromisoformat(e.fired_at) < until
    ]
    return [
        {"fired_at": e.fired_at, "name": e.name, "kind": e.kind, "message": e.message}
        for e in reversed(picked)
    ]


async def collect(
    market: BriefingMarket,
    session: date,
    feeds: Feeds,
    db: sqlite3.Connection,
    *,
    alerts_until: datetime,
) -> Collected:
    data: dict[str, Any] = {
        "market": market,
        "session": session.isoformat(),
        "collected_at": alerts_until.astimezone(KST).isoformat(timespec="seconds"),
    }
    missing: list[str] = []
    sections = _kis_sections(market, session, feeds)
    for name, fetch in sections.items():
        try:
            data[name] = _plain(await fetch())
        except Exception as e:
            if _offline(e):
                raise
            logger.warning("briefing %s %s: %s failed: %s", market, session, name, e)
            missing.append(name)
    if len(missing) == len(sections):
        raise VaterError(
            "BRIEFING_NO_DATA",
            "한국투자증권에서 브리핑 데이터를 받지 못했습니다.",
            "잠시 뒤 다시 시도합니다. 계속되면 설정 > 한국투자증권에서 연결을 확인하세요.",
            status=502,
        )
    data["watchlist"] = await _watchlist(market, feeds, db)
    data["alerts"] = _alerts(market, session, db, alerts_until)
    return Collected(data, missing)
