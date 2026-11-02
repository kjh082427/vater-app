"""동시에 만료 응답을 받은 요청들이 서로의 새 토큰을 지우며 재발급을 반복하면 안 된다.

리뷰 Critical #1.

발급할 때마다 알림톡이 가고, 발급은 분당 1회로 제한된다.
"""

import asyncio
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

from vater_core.kis.auth import TokenManager
from vater_core.kis.client import KisClient
from vater_core.kis.config import KisCredentials, KisServer
from vater_core.kis.ratelimit import PriorityRateLimiter
from vater_core.secrets.names import SecretName
from vater_core.secrets.store import EnvFileSecretStore

KST = ZoneInfo("Asia/Seoul")


async def test_concurrent_expiry_reissues_once(tmp_path: Path) -> None:
    store = EnvFileSecretStore(tmp_path / ".env")
    cached = {"server": "prod", "token": "tok-1", "expires_at": "2026-11-04 03:00:00"}
    store.set(SecretName.KIS_ACCESS_TOKEN, json.dumps(cached))
    issued: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/oauth2/tokenP":
            issued.append("x")
            body = {
                "access_token": f"tok-{len(issued) + 1}",
                "access_token_token_expired": "2026-11-04 03:00:00",
            }
            return httpx.Response(200, json=body)
        await asyncio.sleep(0.05)  # 응답이 늦어 5개 요청이 모두 tok-1을 보낸 상태가 된다
        if request.headers["authorization"] == "Bearer tok-1":
            return httpx.Response(
                500, json={"rt_cd": "1", "msg_cd": "EGW00123", "msg1": "기간이 만료된 token"}
            )
        return httpx.Response(200, json={"rt_cd": "0", "msg_cd": "", "msg1": "", "output": {}})

    creds = KisCredentials(app_key="ak", app_secret="as", hts_id=None)
    now = datetime(2026, 11, 3, 3, 0, tzinfo=KST)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        tokens = TokenManager(http, store, creds, KisServer.PROD, now=lambda: now)
        client = KisClient(
            http, tokens, creds, KisServer.PROD, PriorityRateLimiter(1000), retry_delays=(0, 0, 0)
        )
        results = await asyncio.gather(
            *[client.get("/uapi/x", "FHKST01010100", {}) for _ in range(5)],
            return_exceptions=True,
        )
    assert [r for r in results if isinstance(r, BaseException)] == []
    assert len(issued) == 1  # 재발급은 한 번만
    assert json.loads(store.get(SecretName.KIS_ACCESS_TOKEN) or "{}")["token"] == "tok-2"
