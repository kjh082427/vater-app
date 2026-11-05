"""보유 평가와 자산 추이 API (v2 설계 4-1, 12장). 값이 없으면 null이다."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from vater_core.api.deps import AppDeps, get_deps
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
