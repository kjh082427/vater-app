"""보유 평가와 자산 추이 API (v2 설계 4-1, 12장). 값이 없으면 null이다."""

from datetime import timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from vater_core.api.deps import AppDeps, get_deps
from vater_core.api.errors import VaterError
from vater_core.api.routes.kis import RANGE_DAYS
from vater_core.portfolio.daily import DailyRepo, View, get_daily, point
from vater_core.portfolio.service import get_portfolio

router = APIRouter(prefix="/portfolio", tags=["portfolio"])


class Totals(BaseModel):
    value: float | None
    cost: float | None
    pl: float | None
    pl_pct: float | None


class SymbolValue(Totals):
    market: str
    code: str
    name: str
    total: str
    avg_price: float | None
    currency: str | None
    price: float | None


class PortfolioSummary(BaseModel):
    symbols: list[SymbolValue]
    currencies: dict[str, Totals]
    total_krw: Totals | None  # 달러 자산이 있는데 환율이 없으면 null이다
    usdkrw: float | None
    missing_prices: int  # 시세를 못 받아 합계에서 빠진 종목 수
    unsupported: int  # 국내·미국 외 시장이라 평가하지 않은 행 수
    at: str


@router.get("/summary")
async def portfolio_summary(deps: AppDeps = Depends(get_deps)) -> PortfolioSummary:  # noqa: B008
    return PortfolioSummary(**await get_portfolio(deps).summary())


class HistoryPoint(BaseModel):
    day: str
    value: float | None  # 평가금액. 전체 보기는 그날 환율로 환산하고, 환율이 없으면 null이다
    cost: float | None  # 매입금액
    usdkrw: float | None
    backfilled: bool  # 앱이 꺼져 있던 날을 나중에 채운 값이다


@router.get("/history")
async def portfolio_history(
    range: Annotated[Literal["1m", "3m", "1y", "all"], Query()] = "1m",
    view: Annotated[View, Query()] = "all",
    deps: AppDeps = Depends(get_deps),  # noqa: B008
) -> list[HistoryPoint]:
    """주식 평가금액 추이(오래된 것부터). 예수금은 넣지 않는다."""
    if deps.db is None:
        raise VaterError("DB_UNAVAILABLE", "저장소가 준비되지 않았습니다.", status=503)
    after = None if range == "all" else get_daily(deps).today() - timedelta(days=RANGE_DAYS[range])
    return [HistoryPoint(**point(r, view)) for r in DailyRepo(deps.db).since(after)]
