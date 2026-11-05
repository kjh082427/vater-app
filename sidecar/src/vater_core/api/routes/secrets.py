"""비밀키는 쓰기·삭제만 가능하다. 값을 돌려주는 API는 없다 (스펙 2-3)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Response
from pydantic import BaseModel, ConfigDict

from vater_core.api.deps import AppDeps, get_deps
from vater_core.api.errors import VaterError
from vater_core.logging_setup import refresh_secret_cache
from vater_core.secrets.names import USER_SETTABLE, SecretName
from vater_core.secrets.store import SecretStore

router = APIRouter(prefix="/secrets", tags=["secrets"])

# 명세에는 허용 이름 목록을 알리되, 검증은 핸들러가 한다.
# (FastAPI 검증에 맡기면 틀린 이름이 422가 된다. 지금은 400 SECRET_NAME_INVALID로 답한다.)
_KIS_KEYS = {SecretName.KIS_APP_KEY, SecretName.KIS_APP_SECRET}
SecretPathName = Annotated[str, Path(json_schema_extra={"enum": [n.value for n in USER_SETTABLE]})]


class SecretValue(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    value: str


def get_store(deps: AppDeps = Depends(get_deps)) -> SecretStore:  # noqa: B008
    if deps.secrets is None:
        raise VaterError("SECRETS_UNAVAILABLE", "비밀키 저장소가 준비되지 않았습니다.", status=503)
    return deps.secrets


def _user_name(name: str) -> SecretName:
    for n in USER_SETTABLE:
        if n.value == name:
            return n
    # 이름만 알리고 값은 절대 응답에 넣지 않는다.
    raise VaterError("SECRET_NAME_INVALID", "저장할 수 없는 비밀키 이름입니다.")


@router.get("")
async def secret_status(store: SecretStore = Depends(get_store)) -> dict[str, bool]:  # noqa: B008
    return {n.value: store.get(n) is not None for n in USER_SETTABLE}


@router.put("/{name}", status_code=204)
async def put_secret(
    name: SecretPathName,
    body: SecretValue,
    store: SecretStore = Depends(get_store),  # noqa: B008
) -> Response:
    target = _user_name(name)
    value = body.value.strip()
    if not value:
        raise VaterError("SECRET_VALUE_EMPTY", "값이 비어 있습니다.")
    if target in _KIS_KEYS and store.get(target) != value:
        # 옛 키로 받은 토큰을 새 키에 쓰지 않는다. 같은 값이면 발급(하루 1회 원칙)을 아낀다
        store.delete(SecretName.KIS_ACCESS_TOKEN)
        store.delete(SecretName.KIS_WS_APPROVAL_KEY)
    store.set(target, value)
    refresh_secret_cache()  # 다음 로그부터 새 값을 가린다
    return Response(status_code=204)


@router.delete("/{name}", status_code=204)
async def delete_secret(
    name: SecretPathName,
    store: SecretStore = Depends(get_store),  # noqa: B008
) -> Response:
    store.delete(_user_name(name))
    refresh_secret_cache()
    return Response(status_code=204)
