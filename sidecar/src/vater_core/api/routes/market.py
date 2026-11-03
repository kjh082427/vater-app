"""시장 전체 자료: 지수 현재값과 최근 30거래일 종가 (대시보드 설계 4장)."""

from datetime import date, datetime
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from vater_core.api.deps import AppDeps, get_deps
from vater_core.kis.client import KisClient
from vater_core.kis.market import (
    DomesticMarket,
    IndexQuote,
    OverseasIndex,
    OverseasIndexCode,
    index_daily,
    index_quote,
    overseas_index,
)
from vater_core.kis.models import Bar
from vater_core.kis.services import get_kis
from vater_core.market.indices import IndexBoard

router = APIRouter(prefix="/market", tags=["market"])


class IndexOut(BaseModel):
    code: str
    name: str
    market: Literal["KR", "US"]
    value: float | None
    change: float | None
    change_pct: float | None
    at: datetime | None
    closes: list[float]


class _KisFetch:
    def __init__(self, c: KisClient) -> None:
        self._c = c

    async def kr_quote(self, m: DomesticMarket) -> IndexQuote:
        return await index_quote(self._c, m)

    async def kr_daily(self, m: DomesticMarket, start: date, end: date) -> list[Bar]:
        return await index_daily(self._c, m, start, end)

    async def us_index(self, code: OverseasIndexCode, start: date, end: date) -> OverseasIndex:
        return await overseas_index(self._c, code, start, end)


@router.get("/indices")
async def read_indices(deps: AppDeps = Depends(get_deps)) -> list[IndexOut]:  # noqa: B008
    if deps.indices is None:
        deps.indices = IndexBoard()
    kis = get_kis(deps)
    fetch = _KisFetch(kis.client) if kis else None
    rows = await deps.indices.rows(fetch, kis.fingerprint if kis else None)
    return [IndexOut.model_validate(r, from_attributes=True) for r in rows]
