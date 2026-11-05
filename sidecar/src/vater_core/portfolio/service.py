"""보유 평가 요약 (v2 설계 3, 4-1장). 시세 하나가 실패해도 그 종목만 비운다."""

import logging
import time
from collections.abc import Awaitable, Callable
from datetime import date, datetime
from decimal import Decimal
from typing import Any, cast
from zoneinfo import ZoneInfo

from vater_core.analysis.symbols import resolve_target
from vater_core.api.deps import AppDeps
from vater_core.api.errors import VaterError
from vater_core.holdings.service import get_holdings, summarize
from vater_core.kis.config import Priority
from vater_core.kis.models import UsExchange
from vater_core.kis.quotes import domestic_price, overseas_price
from vater_core.kis.services import require_kis
from vater_core.market.fx import FxRepo, fetch_usdkrw
from vater_core.portfolio.valuation import value_of
from vater_core.store.settings import SettingsRepo

logger = logging.getLogger(__name__)
KST = ZoneInfo("Asia/Seoul")
Key = tuple[str, str]


def _sum(rows: list[dict[str, Any]]) -> dict[str, float | None]:
    """값이 있는 종목만 더한다. 빠진 종목 수는 `missing_prices`로 알린다."""
    values = [r["value"] for r in rows if r["value"] is not None]
    cost = sum(r["cost"] for r in rows if r["pl"] is not None)
    pl = [r["pl"] for r in rows if r["pl"] is not None]
    return {
        "value": sum(values) if values else None,
        "cost": sum(r["cost"] for r in rows if r["cost"] is not None) or None,
        "pl": sum(pl) if pl else None,
        "pl_pct": sum(pl) / cost * 100 if pl and cost else None,
    }


class PortfolioService:
    def __init__(
        self,
        deps: AppDeps,
        *,
        fetch_price: Callable[[str, str], Awaitable[float]] | None = None,
        fetch_fx: Callable[[], Awaitable[float | None]] | None = None,
        now: Callable[[], datetime] = lambda: datetime.now(KST),
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self._deps = deps
        self._fetch_price = fetch_price or self._kis_price
        self._fetch_fx = fetch_fx or self._kis_fx
        self._now = now
        self._monotonic = monotonic
        self._prices: dict[Key, tuple[float, float]] = {}

    @property
    def _db(self) -> Any:
        if self._deps.db is None:
            raise VaterError("DB_UNAVAILABLE", "저장소가 준비되지 않았습니다.", status=503)
        return self._deps.db

    def today(self) -> date:
        return self._now().date()

    async def _kis_price(self, market: str, code: str) -> float:
        client = require_kis(self._deps).client
        if market == "KR":
            return (await domestic_price(client, code, Priority.BRIEFING)).price
        exchange = cast(UsExchange, resolve_target(self._db, market, code).exchange)
        return (await overseas_price(client, exchange, code, Priority.BRIEFING)).price

    async def _kis_fx(self) -> float | None:
        return await fetch_usdkrw(require_kis(self._deps).client, self.today())

    async def price(self, market: str, code: str) -> float | None:
        ttl = int(SettingsRepo(self._db).get("quotes.refresh_sec"))
        now = self._monotonic()
        cached = self._prices.get((market, code))
        if cached and now - cached[1] < ttl:
            return cached[0]
        try:
            value = await self._fetch_price(market, code)
        except Exception as e:  # 한 종목의 실패가 요약 전체를 망치지 않는다
            logger.warning("price failed: %s %s %s", market, code, type(e).__name__)
            return None
        if value <= 0:  # 0은 시세가 없다는 뜻이다. 평가금액을 0으로 만들지 않는다
            return None
        self._prices[(market, code)] = (value, now)
        return value

    async def usdkrw(self, refresh: bool = False) -> float | None:
        """그날 처음 필요할 때 받아 저장한다. 다시 받다 실패하면 저장된 값을 쓴다."""
        repo, day = FxRepo(self._db), self.today()
        saved = repo.get(day)
        if saved is not None and not refresh:
            return saved
        try:
            value = await self._fetch_fx()
        except Exception as e:
            logger.warning("fx failed: %s", type(e).__name__)
            return saved
        if value is None or value <= 0:
            return saved
        repo.save(day, value)
        return value

    async def summary(self) -> dict[str, Any]:
        service = get_holdings(self._deps)
        repo = service.repo
        all_rows = repo.all()
        keys = sorted({(h.market, h.code) for h in all_rows if h.market})
        brokers = repo.brokers()
        symbols: list[dict[str, Any]] = []
        for market, code in keys:
            held = repo.by_symbol(market, code)
            s = summarize(held, brokers, set())
            total = Decimal(s["total"])
            unpriced = Decimal(s["unpriced_quantity"])
            avg = Decimal(str(s["avg_price"])) if s["avg_price"] is not None else None
            price = await self.price(market, code)
            v = value_of(total, avg, price, unpriced)
            symbols.append(
                {
                    "market": market,
                    "code": code,
                    "name": held[0].name,
                    "total": s["total"],
                    "avg_price": s["avg_price"],
                    "currency": s["currency"],
                    "price": price,
                    "value": v.value,
                    "cost": v.cost,
                    "pl": v.pl,
                    "pl_pct": v.pl_pct,
                }
            )
        currencies = {
            c: _sum([r for r in symbols if r["currency"] == c])
            for c in sorted({r["currency"] for r in symbols})
        }
        usdkrw = await self.usdkrw() if "USD" in currencies else None
        return {
            "symbols": symbols,
            "currencies": currencies,
            "total_krw": _converted(currencies, usdkrw),
            "usdkrw": usdkrw,
            "missing_prices": sum(1 for r in symbols if r["price"] is None),
            "unsupported": sum(1 for h in all_rows if h.market is None),
            "at": self._now().isoformat(timespec="seconds"),
        }


def _converted(
    currencies: dict[str, dict[str, float | None]], usdkrw: float | None
) -> dict[str, float | None] | None:
    if not currencies or ("USD" in currencies and usdkrw is None):
        return None
    rate = {"KRW": 1.0, "USD": usdkrw or 0.0}

    def total(field: str) -> float | None:
        known = [
            (c[field] or 0) * rate[name] for name, c in currencies.items() if c[field] is not None
        ]
        return sum(known) if known else None

    pl, cost = total("pl"), total("cost")
    return {
        "value": total("value"),
        "cost": cost,
        "pl": pl,
        "pl_pct": pl / cost * 100 if pl is not None and cost else None,
    }


def get_portfolio(deps: AppDeps) -> PortfolioService:
    if deps.portfolio is None:
        deps.portfolio = PortfolioService(deps)
    return deps.portfolio
