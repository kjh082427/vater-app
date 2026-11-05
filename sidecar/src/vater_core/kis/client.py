"""한국투자증권 REST 클라이언트. **GET 조회만** 제공한다 (주문 기능 없음).

- 공통 헤더(토큰, appkey, appsecret, tr_id, custtype)를 붙인다.
- 우선순위 호출 제한을 거친다.
- `EGW00201`(초당 한도 초과)은 0.5초, 1초, 2초 뒤 최대 3회 재시도한다.
- 토큰 만료(`EGW00123` 또는 HTTP 401)는 토큰을 새로 받아 한 번만 재시도한다.
- `rt_cd != "0"`은 `KisApiError`(KIS_API_ERROR)로 바꾼다.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any, Protocol

import httpx

from vater_core.api.errors import VaterError
from vater_core.kis.config import REST_HOST, KisCredentials, KisServer, Priority
from vater_core.kis.ratelimit import PriorityRateLimiter

logger = logging.getLogger(__name__)

RATE_LIMITED = "EGW00201"
TOKEN_EXPIRED = "EGW00123"  # noqa: S105  (오류 코드이지 비밀값이 아니다)


class TokenSource(Protocol):
    async def token(self) -> str: ...
    async def invalidate(self, rejected: str | None = None) -> None: ...


class KisApiError(VaterError):
    def __init__(self, msg_cd: str, msg1: str) -> None:
        super().__init__("KIS_API_ERROR", f"한국투자증권: {msg1}", None, status=502)
        self.msg_cd = msg_cd


class KisClient:
    def __init__(
        self,
        http: httpx.AsyncClient,
        tokens: TokenSource,
        creds: KisCredentials,
        server: KisServer,
        limiter: PriorityRateLimiter,
        retry_delays: tuple[float, ...] = (0.5, 1.0, 2.0),
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._http = http
        self._tokens = tokens
        self._creds = creds
        self.server = server
        self._limiter = limiter
        self._retry_delays = retry_delays
        self._sleep = sleep

    async def get(
        self,
        path: str,
        tr_id: str,
        params: dict[str, str],
        priority: Priority = Priority.ALERTS,
        tr_cont: str = "",
    ) -> dict[str, Any]:
        body, _ = await self.get_page(path, tr_id, params, priority, tr_cont)
        return body

    async def get_page(
        self,
        path: str,
        tr_id: str,
        params: dict[str, str],
        priority: Priority = Priority.ALERTS,
        tr_cont: str = "",
    ) -> tuple[dict[str, Any], str]:
        """응답 본문과 연속 조회 헤더(`F`·`M`이면 다음 쪽이 있다)."""
        retries = 0
        refreshed = False
        while True:
            await self._limiter.acquire(priority)
            sent_token = await self._tokens.token()
            headers = {
                "content-type": "application/json; charset=utf-8",
                "authorization": f"Bearer {sent_token}",
                "appkey": self._creds.app_key,
                "appsecret": self._creds.app_secret,
                "tr_id": tr_id,
                "custtype": "P",
            }
            if tr_cont:
                headers["tr_cont"] = tr_cont
            try:
                r = await self._http.get(
                    REST_HOST[self.server] + path, params=params, headers=headers
                )
            except httpx.TransportError as e:
                raise VaterError(
                    "KIS_UNREACHABLE",
                    "한국투자증권 서버에 연결할 수 없습니다.",
                    "인터넷 연결을 확인해 주세요.",
                    503,
                ) from e
            try:
                body: dict[str, Any] = r.json()
            except ValueError:
                body = {}
            msg_cd = str(body.get("msg_cd", ""))

            if msg_cd == RATE_LIMITED:
                if retries < len(self._retry_delays):
                    await self._sleep(self._retry_delays[retries])
                    retries += 1
                    continue
                raise VaterError(
                    "KIS_RATE_LIMITED",
                    "한국투자증권 호출 한도를 넘었습니다.",
                    "잠시 후 다시 시도해 주세요.",
                    429,
                )
            if msg_cd == TOKEN_EXPIRED or r.status_code == 401:
                if not refreshed:
                    logger.info("KIS token rejected (%s); refreshing once", msg_cd or r.status_code)
                    await self._tokens.invalidate(sent_token)
                    refreshed = True
                    continue
                raise VaterError(
                    "KIS_AUTH_INVALID",
                    "한국투자증권 인증에 실패했습니다.",
                    "앱키와 실전/모의 서버 선택을 확인해 주세요.",
                    401,
                )
            if body.get("rt_cd") == "0":
                return body, r.headers.get("tr_cont", "")
            raise KisApiError(msg_cd, str(body.get("msg1") or f"HTTP {r.status_code}"))
