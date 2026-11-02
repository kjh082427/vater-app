import asyncio
import json
import logging
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pytest
import respx

from vater_core.api.errors import VaterError
from vater_core.kis.auth import TokenManager
from vater_core.kis.config import REST_HOST, KisCredentials, KisServer
from vater_core.secrets.names import SecretName
from vater_core.secrets.store import EnvFileSecretStore

KST = ZoneInfo("Asia/Seoul")
NOW = datetime(2026, 11, 3, 3, 0, tzinfo=KST)
PROD = REST_HOST[KisServer.PROD]
CREDS = KisCredentials(app_key="ak-123", app_secret="as-secret-456", hts_id=None)


def ok_token(token: str = "tok-new", expires: str = "2026-11-04 03:00:00") -> httpx.Response:
    body = {"access_token": token, "access_token_token_expired": expires,
            "token_type": "Bearer", "expires_in": 86400}  # fmt: skip
    return httpx.Response(200, json=body)


@pytest.fixture
def store(tmp_path: Path) -> EnvFileSecretStore:
    return EnvFileSecretStore(tmp_path / ".env")


def manager(store: EnvFileSecretStore, http: httpx.AsyncClient, server: KisServer = KisServer.PROD,
            now: datetime = NOW) -> TokenManager:  # fmt: skip
    return TokenManager(http, store, CREDS, server, now=lambda: now)


def cache(store: EnvFileSecretStore, server: str, token: str, expires_at: str) -> None:
    store.set(SecretName.KIS_ACCESS_TOKEN,
              json.dumps({"server": server, "token": token, "expires_at": expires_at}))  # fmt: skip


@respx.mock
async def test_cached_valid_token_skips_issuance(store: EnvFileSecretStore) -> None:
    route = respx.post(f"{PROD}/oauth2/tokenP").mock(return_value=ok_token())
    cache(store, "prod", "tok-cached", "2026-11-03 06:00:00")  # 3시간 뒤 만료
    async with httpx.AsyncClient() as http:
        assert await manager(store, http).token() == "tok-cached"
    assert route.call_count == 0


@respx.mock
async def test_expiring_within_hour_reissues(store: EnvFileSecretStore) -> None:
    route = respx.post(f"{PROD}/oauth2/tokenP").mock(return_value=ok_token())
    cache(store, "prod", "tok-old", "2026-11-03 03:30:00")  # 30분 뒤 만료
    async with httpx.AsyncClient() as http:
        assert await manager(store, http).token() == "tok-new"
    assert route.call_count == 1
    saved = json.loads(store.get(SecretName.KIS_ACCESS_TOKEN) or "{}")
    assert saved == {"server": "prod", "token": "tok-new", "expires_at": "2026-11-04 03:00:00"}


@respx.mock
async def test_concurrent_first_calls_issue_once(store: EnvFileSecretStore) -> None:
    route = respx.post(f"{PROD}/oauth2/tokenP").mock(return_value=ok_token())
    async with httpx.AsyncClient() as http:
        tm = manager(store, http)
        tokens = await asyncio.gather(*[tm.token() for _ in range(10)])
    assert set(tokens) == {"tok-new"} and route.call_count == 1


@respx.mock
async def test_memory_cache_avoids_store_reads(store: EnvFileSecretStore) -> None:
    respx.post(f"{PROD}/oauth2/tokenP").mock(return_value=ok_token())
    async with httpx.AsyncClient() as http:
        tm = manager(store, http)
        await tm.token()
        store.delete(SecretName.KIS_ACCESS_TOKEN)  # 저장소가 비어도 메모리 값으로 응답
        assert await tm.token() == "tok-new"


@respx.mock
async def test_server_mismatch_reissues(store: EnvFileSecretStore) -> None:
    route = respx.post(f"{PROD}/oauth2/tokenP").mock(return_value=ok_token())
    cache(store, "vps", "tok-vps", "2026-11-04 00:00:00")
    async with httpx.AsyncClient() as http:
        assert await manager(store, http).token() == "tok-new"
    assert route.call_count == 1


@respx.mock
async def test_invalidate_forces_reissue(store: EnvFileSecretStore) -> None:
    route = respx.post(f"{PROD}/oauth2/tokenP").mock(return_value=ok_token())
    async with httpx.AsyncClient() as http:
        tm = manager(store, http)
        await tm.token()
        await tm.invalidate()
        await tm.token()
    assert route.call_count == 2


@respx.mock
async def test_invalid_key_maps_to_auth_invalid(store: EnvFileSecretStore) -> None:
    body = {"error_code": "EGW00103", "error_description": "유효하지 않은 AppKey입니다."}
    respx.post(f"{PROD}/oauth2/tokenP").mock(return_value=httpx.Response(403, json=body))
    async with httpx.AsyncClient() as http:
        with pytest.raises(VaterError) as e:
            await manager(store, http).token()
    assert e.value.code == "KIS_AUTH_INVALID" and e.value.status == 401


@respx.mock
async def test_issue_rate_limit_maps(store: EnvFileSecretStore) -> None:
    body = {
        "error_code": "EGW00133",
        "error_description": "접근토큰 발급 잠시 후 다시 시도하세요(1분당 1회)",
    }
    respx.post(f"{PROD}/oauth2/tokenP").mock(return_value=httpx.Response(403, json=body))
    async with httpx.AsyncClient() as http:
        with pytest.raises(VaterError) as e:
            await manager(store, http).token()
    assert e.value.code == "KIS_RATE_LIMITED" and e.value.status == 429


@respx.mock
async def test_network_error_maps_to_unreachable(store: EnvFileSecretStore) -> None:
    respx.post(f"{PROD}/oauth2/tokenP").mock(side_effect=httpx.ConnectError("down"))
    async with httpx.AsyncClient() as http:
        with pytest.raises(VaterError) as e:
            await manager(store, http).token()
    assert e.value.code == "KIS_UNREACHABLE"


@respx.mock
async def test_request_body_and_secret_not_logged(
    store: EnvFileSecretStore, caplog: pytest.LogCaptureFixture
) -> None:
    route = respx.post(f"{PROD}/oauth2/tokenP").mock(return_value=ok_token())
    caplog.set_level(logging.DEBUG)
    async with httpx.AsyncClient() as http:
        await manager(store, http).token()
    sent = json.loads(route.calls[0].request.content)
    assert sent == {
        "grant_type": "client_credentials",
        "appkey": "ak-123",
        "appsecret": "as-secret-456",
    }
    assert "as-secret-456" not in caplog.text and "tok-new" not in caplog.text


@respx.mock
async def test_approval_key_body_uses_secretkey_and_caches(store: EnvFileSecretStore) -> None:
    route = respx.post(f"{PROD}/oauth2/Approval").mock(
        return_value=httpx.Response(200, json={"approval_key": "appr-1"})
    )
    async with httpx.AsyncClient() as http:
        assert await manager(store, http).approval_key() == "appr-1"
        # 새 인스턴스(앱 재시작)도 캐시를 쓴다
        assert await manager(store, http, now=NOW + timedelta(hours=5)).approval_key() == "appr-1"
    assert route.call_count == 1
    sent = json.loads(route.calls[0].request.content)
    assert sent == {
        "grant_type": "client_credentials",
        "appkey": "ak-123",
        "secretkey": "as-secret-456",
    }


@respx.mock
async def test_approval_key_expires_after_20h(store: EnvFileSecretStore) -> None:
    route = respx.post(f"{PROD}/oauth2/Approval").mock(
        return_value=httpx.Response(200, json={"approval_key": "appr-1"})
    )
    async with httpx.AsyncClient() as http:
        await manager(store, http).approval_key()
        await manager(store, http, now=NOW + timedelta(hours=21)).approval_key()
    assert route.call_count == 2


@respx.mock
async def test_cache_json_is_small(store: EnvFileSecretStore) -> None:
    respx.post(f"{PROD}/oauth2/tokenP").mock(return_value=ok_token(token="t" * 400))
    async with httpx.AsyncClient() as http:
        await manager(store, http).token()
    assert len(store.get(SecretName.KIS_ACCESS_TOKEN) or "") < 1000
