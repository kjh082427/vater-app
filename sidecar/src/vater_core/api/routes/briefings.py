"""일일 시장 브리핑 API (스펙 2-3, 6장).

숫자는 `data`(한투 수집값)로 화면이 직접 그리고, `text`(LLM 해석 문장)에는 숫자가 없다.
SSE: `briefing.status` `{market, date, status: running|done|partial|failed, id?, error?}`
"""

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from vater_core.api.deps import AppDeps, get_deps
from vater_core.api.errors import VaterError
from vater_core.briefing.service import get_briefing
from vater_core.briefing.store import Briefing, BriefingRepo

router = APIRouter(prefix="/briefings", tags=["briefings"])

Market = Literal["KR", "US"]


class BriefingItem(BaseModel):
    id: int
    market: str
    date: str  # 세션 날짜 (국내는 한국, 미국은 뉴욕 날짜)
    status: Literal["done", "partial"]
    headline: str | None  # 해석이 없거나 비었으면 null
    missing: list[str]  # 받지 못한 항목 (interpretation = AI 해석)
    created_at: str


class AssetChange(BaseModel):
    change: float | None
    change_pct: float | None


class AssetMove(BaseModel):
    code: str
    name: str
    amount: float  # `currency` 통화 그대로의 금액
    currency: str


class MyAssets(BaseModel):
    """앱이 계산한 내 자산 구역. AI를 거치지 않는다. 전일 기록이 없으면 변화 값은 null이다."""

    change_krw: float | None  # 원화 환산 변화. 환율이나 종가가 없으면 null이다
    change_pct: float | None
    currencies: dict[str, AssetChange]
    top: AssetMove | None
    bottom: AssetMove | None


class InterpretError(BaseModel):
    """AI 해석이 없는 이유. 분석과 같은 구분이다: LLM_BUSY(혼잡), LLM_RATE_LIMITED(분당 한도),
    LLM_DAILY_LIMIT(하루 한도), LLM_KEY_INVALID·LLM_KEY_MISSING(키), BRIEFING_LLM_FAILED(그 밖)."""

    code: str
    message: str


class BriefingDetail(BriefingItem):
    data: dict[str, Any]
    text: dict[str, str] | None
    interpret_error: InterpretError | None = None  # 해석이 없을 때만 의미가 있다
    my_assets: MyAssets | None = None  # 보유 내역이 없으면 null이고 빠진 항목으로 세지 않는다


class BriefingRunRequest(BaseModel):
    market: Market


class BriefingRunAccepted(BaseModel):
    market: str
    date: str


def _repo(deps: AppDeps) -> BriefingRepo:
    if deps.db is None:
        raise VaterError("DB_UNAVAILABLE", "저장소가 준비되지 않았습니다.", status=503)
    return BriefingRepo(deps.db)


def _item(b: Briefing) -> dict[str, Any]:
    return {
        "id": b.id,
        "market": b.market,
        "date": b.date,
        "status": b.status,
        "headline": (b.text or {}).get("headline") or None,
        "missing": b.missing,
        "created_at": b.created_at,
    }


@router.get("")
async def list_briefings(
    market: Market | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 30,
    deps: AppDeps = Depends(get_deps),  # noqa: B008
) -> list[BriefingItem]:
    return [BriefingItem(**_item(b)) for b in _repo(deps).list(market, limit)]


@router.get("/{bid}")
async def read_briefing(bid: int, deps: AppDeps = Depends(get_deps)) -> BriefingDetail:  # noqa: B008
    b = _repo(deps).get(bid)
    assets = MyAssets(**b.my_assets) if b.my_assets else None
    error = InterpretError(**b.interpret_error) if b.interpret_error else None
    return BriefingDetail(
        **_item(b), data=b.data, text=b.text, interpret_error=error, my_assets=assets
    )


@router.post("/run", status_code=202)
async def run_briefing(
    body: BriefingRunRequest,
    deps: AppDeps = Depends(get_deps),  # noqa: B008
) -> BriefingRunAccepted:
    session = await get_briefing(deps).run_latest(body.market)
    return BriefingRunAccepted(market=body.market, date=session.isoformat())


@router.post("/{bid}/interpret", status_code=202)
async def interpret_briefing(
    bid: int,
    deps: AppDeps = Depends(get_deps),  # noqa: B008
) -> BriefingRunAccepted:
    """해석만 다시 만든다(백그라운드). 진행은 SSE `briefing.status`, 이유는 `interpret_error`."""
    b = get_briefing(deps).start_reinterpret(bid)
    return BriefingRunAccepted(market=b.market, date=b.date)
