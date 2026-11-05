"""분류로 종목 찾기 (v2 설계 11장). 분류표는 앱에 든 파일이고 개인 자료는 쓰지 않는다."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from vater_core.api.deps import AppDeps, get_deps
from vater_core.api.errors import VaterError
from vater_core.categories import service

router = APIRouter(prefix="/categories", tags=["categories"])
MarketQ = Annotated[Literal["KR", "US", "ALL"], Query(description="시장 (기본 통합)")]


class MidOut(BaseModel):
    id: str
    name: str


class GroupOut(BaseModel):
    id: str
    name: str
    mids: list[MidOut]


class CategoryStockOut(BaseModel):
    market: str
    code: str
    exchange: str
    name: str
    name_en: str | None
    kind: str
    mids: list[str]  # 이 종목이 든 중분류 id들 (비어 있으면 미분류)


class NodeHitOut(BaseModel):
    id: str
    name: str
    level: Literal["group", "mid"]
    parent: str | None  # 중분류의 대분류 이름
    match: Literal["name", "keyword"]
    keyword: str | None
    count: int  # 고른 시장에 상장된 종목 수


class CategorySearchOut(BaseModel):
    nodes: list[NodeHitOut]
    stocks: list[CategoryStockOut]


def _db(deps: AppDeps):  # type: ignore[no-untyped-def]
    if deps.db is None:
        raise VaterError("DB_UNAVAILABLE", "저장소가 준비되지 않았습니다.", status=503)
    return deps.db


def _stock(c: service.CategoryStock) -> CategoryStockOut:
    return CategoryStockOut(**c.symbol.__dict__, mids=c.mids)


@router.get("")
async def read_tree() -> list[GroupOut]:
    cat = service.load_catalog()
    tree = [
        GroupOut(id=g.id, name=g.name, mids=[MidOut(id=m.id, name=m.name) for m in mids])
        for g, mids in cat.groups
    ]
    return [*tree, GroupOut(id=service.UNCLASSIFIED, name="미분류", mids=[])]


@router.get("/stocks")
async def read_stocks(
    node: Annotated[str, Query(min_length=1, description="대분류·중분류 id 또는 unclassified")],
    market: MarketQ = "ALL",
    deps: AppDeps = Depends(get_deps),  # noqa: B008
) -> list[CategoryStockOut]:
    rows = service.stocks_of(_db(deps), service.load_catalog(), node, market)
    if rows is None:
        raise VaterError("CATEGORY_NOT_FOUND", "없는 분류입니다.", status=404)
    return [_stock(r) for r in rows]


@router.get("/search")
async def search_categories(
    q: Annotated[
        str, Query(min_length=1, max_length=50, description="분류 이름, 테마 키워드, 종목명")
    ],
    market: MarketQ = "ALL",
    deps: AppDeps = Depends(get_deps),  # noqa: B008
) -> CategorySearchOut:
    hits, stocks = service.search(_db(deps), service.load_catalog(), q, market)
    return CategorySearchOut(
        nodes=[
            NodeHitOut(
                id=h.node.id,
                name=h.node.name,
                level=h.node.level,
                parent=h.node.parent,
                match=h.match,
                keyword=h.keyword,
                count=h.count,
            )
            for h in hits
        ],
        stocks=[_stock(s) for s in stocks],
    )
