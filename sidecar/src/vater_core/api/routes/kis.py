"""한국투자증권 관련 API: 종목 검색, 연결 테스트."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from vater_core.api.deps import AppDeps, get_deps
from vater_core.api.errors import VaterError
from vater_core.kis.master import search_symbols

router = APIRouter(tags=["kis"])


class SymbolOut(BaseModel):
    market: str
    code: str
    exchange: str
    name: str
    name_en: str | None
    kind: str


@router.get("/symbols/search")
async def symbols_search(
    q: Annotated[str, Query(min_length=1, max_length=50, description="종목명, 영문명 또는 코드")],
    deps: AppDeps = Depends(get_deps),  # noqa: B008
) -> list[SymbolOut]:
    if deps.db is None:
        raise VaterError("DB_UNAVAILABLE", "저장소가 준비되지 않았습니다.", status=503)
    return [SymbolOut(**s.__dict__) for s in search_symbols(deps.db, q)]
