"""일회용 토큰 인증. Tauri가 실행할 때마다 새 토큰을 `VATER_TOKEN`으로 넘긴다."""

import hmac

from fastapi import Request

from vater_core.api.deps import get_deps
from vater_core.api.errors import VaterError

_AUTH_ERROR = VaterError(
    "AUTH_INVALID", "인증 토큰이 올바르지 않습니다.", "앱을 다시 시작해 주세요.", status=401
)


def _matches(given: str | None, expected: str) -> bool:
    return given is not None and hmac.compare_digest(given.encode(), expected.encode())


def _bearer(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    scheme, _, value = header.partition(" ")
    return value.strip() if scheme.lower() == "bearer" and value else None


async def require_token(request: Request) -> None:
    """`Authorization: Bearer <token>` 헤더만 받는다."""
    if not _matches(_bearer(request), get_deps(request).token):
        raise _AUTH_ERROR


async def require_token_or_query(request: Request) -> None:
    """SSE 전용: 브라우저 EventSource는 헤더를 못 붙이므로 `?token=`도 받는다."""
    expected = get_deps(request).token
    from_query = request.query_params.get("token")
    if not (_matches(_bearer(request), expected) or _matches(from_query, expected)):
        raise _AUTH_ERROR
