"""상태 확인과 정상 종료."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel

import vater_core
from vater_core.api.deps import AppDeps, get_deps

router = APIRouter(tags=["system"])


class Health(BaseModel):
    status: str
    version: str


class ShutdownAccepted(BaseModel):
    status: str


@router.get("/health")
async def health() -> Health:
    return Health(status="ok", version=vater_core.__version__)


@router.post("/shutdown", status_code=202)
async def shutdown(deps: AppDeps = Depends(get_deps)) -> ShutdownAccepted:  # noqa: B008
    deps.shutdown()
    return ShutdownAccepted(status="shutting_down")
