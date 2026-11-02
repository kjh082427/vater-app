"""AI 분석 API (스펙 2-3, 5장). 분석은 오래 걸려서 202로 바로 응답하고, 진행은 SSE로 보낸다.

- `analysis.status` `{id, status, decision?, error?}`
- `analysis.progress` `{id, stage, node, elapsed_sec}`
"""

from datetime import date
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from vater_core.analysis.queue import get_analysis
from vater_core.analysis.store import Analysis, AnalysisRepo
from vater_core.analysis.summary import decision_ko
from vater_core.api.deps import AppDeps, get_deps
from vater_core.api.errors import VaterError

router = APIRouter(prefix="/analyses", tags=["analyses"])


class AnalysisCreate(BaseModel):
    market: Literal["KR", "US"]
    code: str = Field(min_length=1, max_length=12, pattern=r"^[A-Za-z0-9.\-]+$")
    as_of: date | None = None  # 없으면 최근 거래일
    preset: Literal["cloud", "local", "mixed"] | None = None  # 없으면 설정값


class AnalysisQueued(BaseModel):
    id: int
    status: str


class AnalysisItem(BaseModel):
    id: int
    market: str
    code: str
    name: str | None
    as_of: str
    preset: str
    status: str
    decision: str | None
    decision_ko: str | None
    decision_changed: bool  # 같은 종목의 직전 완료 분석과 결정이 다름
    created_at: str


class ModelChoice(BaseModel):
    provider: str
    model: str


class ErrorInfo(BaseModel):
    code: str
    message: str
    hint: str | None = None


class AnalysisDetail(AnalysisItem):
    models: dict[str, ModelChoice] | None
    summary: list[str] | None
    price_target: str | None
    time_horizon: str | None
    reports: dict[str, str] | None
    timings: dict[str, float] | None
    tokens: dict[str, int] | None
    error: ErrorInfo | None


def _repo(deps: AppDeps) -> AnalysisRepo:
    if deps.db is None:
        raise VaterError("DB_UNAVAILABLE", "저장소가 준비되지 않았습니다.", status=503)
    return AnalysisRepo(deps.db)


def _changed(repo: AnalysisRepo, a: Analysis) -> bool:
    if a.status != "done" or a.decision is None:
        return False
    prev = repo.previous_done(a.market, a.code, before_id=a.id)
    return prev is not None and prev.decision != a.decision


def _item(repo: AnalysisRepo, a: Analysis) -> dict[str, Any]:
    return {
        "id": a.id,
        "market": a.market,
        "code": a.code,
        "name": a.name,
        "as_of": a.as_of,
        "preset": a.preset,
        "status": a.status,
        "decision": a.decision,
        "decision_ko": decision_ko(a.decision),
        "decision_changed": _changed(repo, a),
        "created_at": a.created_at,
    }


@router.post("", status_code=202)
async def create_analysis(
    body: AnalysisCreate,
    deps: AppDeps = Depends(get_deps),  # noqa: B008
) -> AnalysisQueued:
    aid = await get_analysis(deps).submit(body.market, body.code, body.as_of, body.preset)
    return AnalysisQueued(id=aid, status="queued")


@router.get("")
async def list_analyses(
    market: Literal["KR", "US"] | None = None,
    code: Annotated[str | None, Query(max_length=12)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    deps: AppDeps = Depends(get_deps),  # noqa: B008
) -> list[AnalysisItem]:
    repo = _repo(deps)
    return [AnalysisItem(**_item(repo, a)) for a in repo.list(market, code, limit)]


@router.get("/{aid}")
async def read_analysis(aid: int, deps: AppDeps = Depends(get_deps)) -> AnalysisDetail:  # noqa: B008
    repo = _repo(deps)
    a = repo.get(aid)
    return AnalysisDetail(
        **_item(repo, a),
        models=a.models,
        summary=a.summary,
        price_target=a.price_target,
        time_horizon=a.time_horizon,
        reports=a.reports,
        timings=a.timings,
        tokens=a.tokens,
        error=ErrorInfo(**a.error) if a.error else None,
    )


@router.post("/{aid}/cancel")
async def cancel_analysis(aid: int, deps: AppDeps = Depends(get_deps)) -> AnalysisQueued:  # noqa: B008
    status = await get_analysis(deps).cancel(aid)
    return AnalysisQueued(id=aid, status=status)


@router.post("/{aid}/retry", status_code=202)
async def retry_analysis(aid: int, deps: AppDeps = Depends(get_deps)) -> AnalysisQueued:  # noqa: B008
    new_id = await get_analysis(deps).retry(aid)
    return AnalysisQueued(id=new_id, status="queued")
