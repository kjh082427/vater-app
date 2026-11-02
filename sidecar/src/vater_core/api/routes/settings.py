"""설정 조회와 변경."""

from typing import Any

from fastapi import APIRouter, Body, Depends

from vater_core.api.deps import AppDeps, get_deps
from vater_core.api.errors import VaterError
from vater_core.store.settings import SettingsRepo

router = APIRouter(prefix="/settings", tags=["settings"])


def get_settings_repo(deps: AppDeps = Depends(get_deps)) -> SettingsRepo:  # noqa: B008
    if deps.db is None:
        raise VaterError(
            "DB_UNAVAILABLE", "저장소가 준비되지 않았습니다.", "앱을 다시 시작해 주세요.", 503
        )
    return SettingsRepo(deps.db)


@router.get("")
async def read_settings(repo: SettingsRepo = Depends(get_settings_repo)) -> dict[str, Any]:  # noqa: B008
    return repo.get_all()


@router.patch("")
async def update_settings(
    changes: dict[str, Any] = Body(...),  # noqa: B008
    repo: SettingsRepo = Depends(get_settings_repo),  # noqa: B008
) -> dict[str, Any]:
    return repo.update(changes)
