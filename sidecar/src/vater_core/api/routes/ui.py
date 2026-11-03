"""화면 상태 저장: 홈 대시보드 배치 (대시보드 설계 4장)."""

from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from vater_core.api.deps import AppDeps, get_deps
from vater_core.api.errors import VaterError
from vater_core.store.dashboards import DashboardRepo, parse_body

router = APIRouter(prefix="/ui", tags=["ui"])


class KpiStrip(BaseModel):
    enabled: bool
    items: list[str]


class Layout(BaseModel):
    template: str
    root: dict[str, Any]


class Panel(BaseModel):
    type: str
    options: dict[str, Any]


class Dashboard(BaseModel):
    id: str
    name: str
    kpi: KpiStrip
    layout: Layout
    panels: list[Panel]


class DashboardsDoc(BaseModel):
    version: int
    dashboards: list[Dashboard]


def get_dashboard_repo(deps: AppDeps = Depends(get_deps)) -> DashboardRepo:  # noqa: B008
    if deps.db is None:
        raise VaterError(
            "DB_UNAVAILABLE", "저장소가 준비되지 않았습니다.", "앱을 다시 시작해 주세요.", 503
        )
    return DashboardRepo(deps.db)


@router.get("/dashboards")
async def read_dashboards(
    repo: DashboardRepo = Depends(get_dashboard_repo),  # noqa: B008
) -> DashboardsDoc:
    return DashboardsDoc.model_validate(repo.get())


@router.put(
    "/dashboards",
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "application/json": {"schema": {"$ref": "#/components/schemas/DashboardsDoc"}}
            },
        }
    },
)
async def write_dashboards(
    request: Request,
    repo: DashboardRepo = Depends(get_dashboard_repo),  # noqa: B008
) -> DashboardsDoc:
    # 크기를 원본 바이트로 먼저 재고, 모양은 직접 검사한다(오류를 422 DASHBOARD_INVALID 하나로).
    doc = parse_body(await request.body())
    return DashboardsDoc.model_validate(repo.put(doc))
