"""허용 목록 HTTP. 어댑터는 이것으로만 증권사를 부른다 (v2 설계 8장).

키가 주문까지 가능한 키라서 앱이 막아야 한다. 허용 목록 밖의 호출은 요청을 보내기 전에 거절한다.
"""

from typing import Any
from urllib.parse import urlsplit

import httpx

from vater_core.api.errors import VaterError


def _blocked(method: str, path: str) -> VaterError:
    return VaterError(
        "BROKER_CALL_BLOCKED", f"허용되지 않은 증권사 호출입니다: {method} {path}", status=500
    )


class ReadOnlyHttp:
    def __init__(
        self, http: httpx.AsyncClient, base_url: str, allowed: frozenset[tuple[str, str]]
    ) -> None:
        self._http = http
        self._base = base_url.rstrip("/")
        self._allowed = allowed

    async def request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        parts = urlsplit(path)
        if parts.scheme or parts.netloc or ".." in path or (method, path) not in self._allowed:
            raise _blocked(method, path)
        try:
            return await self._http.request(method, self._base + path, **kwargs)
        except httpx.TransportError as e:
            raise VaterError(
                "BROKER_UNREACHABLE",
                "증권사 서버에 연결할 수 없습니다.",
                "인터넷 연결을 확인하고 다시 시도해 주세요.",
                status=503,
            ) from e
