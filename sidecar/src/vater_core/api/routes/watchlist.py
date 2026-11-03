"""감시 종목 API (스펙 2-3, 4장). 종목 이름·거래소는 종목 마스터에서 채운다."""

import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field

from vater_core.alerts.monitor import get_alerts
from vater_core.alerts.store import WatchItem, WatchlistRepo
from vater_core.analysis.symbols import resolve_target
from vater_core.api.deps import AppDeps, get_deps
from vater_core.api.errors import VaterError

router = APIRouter(prefix="/watchlist", tags=["watchlist"])


class WatchCreate(BaseModel):
    market: Literal["KR", "US"]
    code: str = Field(min_length=1, max_length=12, pattern=r"^[A-Za-z0-9.\-]+$")


class WatchItemOut(BaseModel):
    id: int
    market: str
    code: str
    exchange: str
    name: str
    created_at: str


class WatchQuoteOut(BaseModel):
    """홈 화면 감시 종목 한 줄. 시세를 받지 못하면 가격 칸이 null."""

    watchlist_id: int
    market: str
    code: str
    name: str
    price: float | None
    change: float | None  # 전일 대비 금액. 전일 종가를 모르면 null
    change_pct: float | None
    at: str | None  # 시세 시각(KST)
    source: Literal["realtime", "polling", "rest"] | None
    feed: Literal["realtime", "polling", "idle", "closed", "offline"]


def _db(deps: AppDeps) -> sqlite3.Connection:
    if deps.db is None:
        raise VaterError("DB_UNAVAILABLE", "저장소가 준비되지 않았습니다.", status=503)
    return deps.db


def _repo(deps: AppDeps) -> WatchlistRepo:
    return WatchlistRepo(_db(deps))


def _out(w: WatchItem) -> WatchItemOut:
    return WatchItemOut(
        id=w.id,
        market=w.market,
        code=w.code,
        exchange=w.exchange,
        name=w.name,
        created_at=w.created_at,
    )


@router.get("")
async def list_watchlist(deps: AppDeps = Depends(get_deps)) -> list[WatchItemOut]:  # noqa: B008
    return [_out(w) for w in _repo(deps).list()]


@router.get("/quotes")
async def watch_quotes(deps: AppDeps = Depends(get_deps)) -> list[WatchQuoteOut]:  # noqa: B008
    """감시 종목마다 최신 시세와 수신 상태. 실시간 갱신은 SSE `quote`로 받는다."""
    return [WatchQuoteOut(**q) for q in await get_alerts(deps).watch_quotes()]


@router.post("", status_code=201)
async def add_watch(body: WatchCreate, deps: AppDeps = Depends(get_deps)) -> WatchItemOut:  # noqa: B008
    db = _db(deps)
    code = body.code.upper() if body.market == "US" else body.code  # 미국 티커는 대문자로 저장
    return _out(WatchlistRepo(db).add(resolve_target(db, body.market, code)))


@router.delete("/{wid}", status_code=204)
async def remove_watch(wid: int, deps: AppDeps = Depends(get_deps)) -> Response:  # noqa: B008
    _repo(deps).remove(wid)  # 그 종목의 알림 규칙도 함께 지운다
    return Response(status_code=204)
