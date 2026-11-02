"""접근 토큰과 WebSocket 승인키 관리.

- 토큰은 발급할 때마다 사용자에게 **알림톡이 간다**. 그래서 비밀키 저장소에 캐시해서
  앱을 다시 켜도 유효한 토큰이 있으면 발급하지 않는다.
- 만료 시각은 발급 응답의 `access_token_token_expired`(KST)를 그대로 쓰고, 1시간 전에 재발급한다.
- 여러 요청이 동시에 와도 발급은 잠금으로 한 번만 한다(분당 1회 제한).
"""

import asyncio
import json
import logging
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from vater_core.api.errors import VaterError
from vater_core.kis.config import REST_HOST, KisCredentials, KisServer
from vater_core.secrets.names import SecretName
from vater_core.secrets.store import SecretStore

logger = logging.getLogger(__name__)

KST = ZoneInfo("Asia/Seoul")
TIME_FORMAT = "%Y-%m-%d %H:%M:%S"
TOKEN_MARGIN = timedelta(hours=1)
APPROVAL_TTL = timedelta(hours=20)
JSON_HEADERS = {"content-type": "application/json; charset=utf-8"}


def kst_now() -> datetime:
    return datetime.now(KST)


def _parse_kst(text: str) -> datetime:
    return datetime.strptime(text, TIME_FORMAT).replace(tzinfo=KST)


def _issue_error(status: int, body: dict[str, Any]) -> VaterError:
    code = str(body.get("error_code", ""))
    detail = str(body.get("error_description") or body.get("msg1") or f"HTTP {status}")
    if code == "EGW00133":  # 접근토큰 발급 1분당 1회
        return VaterError(
            "KIS_RATE_LIMITED", f"한국투자증권: {detail}", "1분 뒤 다시 시도해 주세요.", 429
        )
    return VaterError(
        "KIS_AUTH_INVALID",
        f"한국투자증권 인증에 실패했습니다: {detail}",
        "앱키와 앱시크릿, 실전/모의 서버 선택을 확인해 주세요.",
        401,
    )


class TokenManager:
    def __init__(
        self,
        http: httpx.AsyncClient,
        secrets: SecretStore,
        creds: KisCredentials,
        server: KisServer,
        now: Callable[[], datetime] = kst_now,
    ) -> None:
        self._http = http
        self._secrets = secrets
        self._creds = creds
        self.server = server
        self._now = now
        self._lock = asyncio.Lock()
        self._approval_lock = asyncio.Lock()
        self._token: tuple[str, datetime] | None = None  # 메모리 캐시 (keyring을 매번 읽지 않게)
        self._approval: tuple[str, datetime] | None = None

    # ── 접근 토큰 ──────────────────────────────────────────────
    def _valid_token(self) -> str | None:
        if self._token is None:
            self._token = self._load(SecretName.KIS_ACCESS_TOKEN, "token", "expires_at")
        if self._token and self._now() < self._token[1] - TOKEN_MARGIN:
            return self._token[0]
        return None

    async def token(self) -> str:
        if token := self._valid_token():
            return token
        async with self._lock:
            if token := self._valid_token():  # 기다리는 동안 다른 요청이 발급했을 수 있다
                return token
            return await self._issue_token()

    async def invalidate(self, rejected: str | None = None) -> None:
        """서버가 `rejected` 토큰을 만료로 거부했을 때 부른다. 다음 `token()`에서 재발급한다.

        이미 다른 요청이 새 토큰을 받아 두었다면(현재 토큰 ≠ rejected) 아무것도 지우지 않는다.
        동시에 거부된 요청들이 서로의 새 토큰을 지우며 재발급을 반복하는 것을 막는다
        (발급마다 알림톡, 분당 1회 제한).
        """
        async with self._lock:
            current = self._token or self._load(SecretName.KIS_ACCESS_TOKEN, "token", "expires_at")
            if rejected is not None and current is not None and current[0] != rejected:
                self._token = current
                return
            self._token = None
            self._secrets.delete(SecretName.KIS_ACCESS_TOKEN)

    async def _issue_token(self) -> str:
        body = await self._post(
            "/oauth2/tokenP",
            {
                "grant_type": "client_credentials",
                "appkey": self._creds.app_key,
                "appsecret": self._creds.app_secret,
            },
        )
        if "access_token" not in body:
            raise _issue_error(200, body)
        token = str(body["access_token"])
        if expired := body.get("access_token_token_expired"):
            expires_at = _parse_kst(str(expired))
        else:
            expires_at = self._now() + timedelta(seconds=int(body.get("expires_in", 86400)))
        self._token = (token, expires_at)
        self._save(SecretName.KIS_ACCESS_TOKEN, "token", token, "expires_at", expires_at)
        logger.info("KIS access token issued (server=%s, expires %s)", self.server, expires_at)
        return token

    # ── WebSocket 승인키 ───────────────────────────────────────
    def _valid_approval(self) -> str | None:
        if self._approval is None:
            self._approval = self._load(SecretName.KIS_WS_APPROVAL_KEY, "key", "issued_at")
        if self._approval and self._now() < self._approval[1] + APPROVAL_TTL:
            return self._approval[0]
        return None

    async def approval_key(self) -> str:
        if key := self._valid_approval():
            return key
        async with self._approval_lock:
            if key := self._valid_approval():
                return key
            body = await self._post(
                "/oauth2/Approval",
                {
                    "grant_type": "client_credentials",
                    "appkey": self._creds.app_key,
                    "secretkey": self._creds.app_secret,
                },
            )
            if "approval_key" not in body:
                raise _issue_error(200, body)
            key, issued = str(body["approval_key"]), self._now()
            self._approval = (key, issued)
            self._save(SecretName.KIS_WS_APPROVAL_KEY, "key", key, "issued_at", issued)
            logger.info("KIS websocket approval key issued (server=%s)", self.server)
            return key

    # ── 공통 ───────────────────────────────────────────────────
    async def _post(self, path: str, payload: dict[str, str]) -> dict[str, Any]:
        try:
            r = await self._http.post(
                REST_HOST[self.server] + path, json=payload, headers=JSON_HEADERS
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
        if r.status_code != 200:
            raise _issue_error(r.status_code, body)
        return body

    def _load(self, name: SecretName, value_key: str, time_key: str) -> tuple[str, datetime] | None:
        raw = self._secrets.get(name)
        if not raw:
            return None
        try:
            data = json.loads(raw)
            if data.get("server") != self.server.value:
                return None
            return str(data[value_key]), _parse_kst(str(data[time_key]))
        except (ValueError, KeyError, TypeError):
            return None  # 깨진 캐시는 무시하고 새로 발급한다

    def _save(
        self, name: SecretName, value_key: str, value: str, time_key: str, at: datetime
    ) -> None:
        payload = {
            "server": self.server.value,
            value_key: value,
            time_key: at.strftime(TIME_FORMAT),
        }
        self._secrets.set(name, json.dumps(payload, separators=(",", ":")))
