import json
from pathlib import Path
from typing import Any

import httpx
import respx

from vater_core.kis.config import REST_HOST, KisServer
from vater_core.kis.services import get_kis
from vater_core.secrets.names import SecretName

PROD = REST_HOST[KisServer.PROD]
VPS = REST_HOST[KisServer.VPS]
FIX = Path(__file__).parents[1] / "kis" / "fixtures"


def token_ok() -> httpx.Response:
    return httpx.Response(
        200, json={"access_token": "t", "access_token_token_expired": "2099-01-01 00:00:00"}
    )


def price_ok() -> httpx.Response:
    return httpx.Response(
        200, json=json.loads((FIX / "domestic_price.json").read_text(encoding="utf-8"))
    )


def configure(deps: Any) -> None:
    deps.secrets.set(SecretName.KIS_APP_KEY, "ak")
    deps.secrets.set(SecretName.KIS_APP_SECRET, "as")


async def test_kis_test_without_keys_is_409(client: httpx.AsyncClient) -> None:
    r = await client.post("/settings/kis/test")
    assert r.status_code == 409 and r.json()["code"] == "KIS_NOT_CONFIGURED"


@respx.mock
async def test_kis_test_success(client: httpx.AsyncClient, deps: Any) -> None:
    configure(deps)
    respx.post(f"{PROD}/oauth2/tokenP").mock(return_value=token_ok())
    respx.get(f"{PROD}/uapi/domestic-stock/v1/quotations/inquire-price").mock(
        return_value=price_ok()
    )
    r = await client.post("/settings/kis/test")
    assert r.status_code == 200
    assert r.json() == {
        "ok": True,
        "server": "prod",
        "sample": {"code": "005930", "price": 230000.0},
    }


@respx.mock
async def test_kis_test_rejected_key_is_401(client: httpx.AsyncClient, deps: Any) -> None:
    configure(deps)
    body = {"error_code": "EGW00103", "error_description": "유효하지 않은 AppKey입니다."}
    respx.post(f"{PROD}/oauth2/tokenP").mock(return_value=httpx.Response(403, json=body))
    r = await client.post("/settings/kis/test")
    assert r.status_code == 401 and r.json()["code"] == "KIS_AUTH_INVALID"


@respx.mock
async def test_switching_server_rebuilds_services(client: httpx.AsyncClient, deps: Any) -> None:
    configure(deps)
    respx.post(f"{VPS}/oauth2/tokenP").mock(return_value=token_ok())
    respx.get(f"{VPS}/uapi/domestic-stock/v1/quotations/inquire-price").mock(
        return_value=price_ok()
    )
    first = get_kis(deps)
    assert (await client.patch("/settings", json={"kis.server": "vps"})).status_code == 200
    second = get_kis(deps)
    assert first is not None and second is not None and first is not second
    assert second.server == KisServer.VPS and get_kis(deps) is second  # 바뀌지 않으면 재사용
    r = await client.post("/settings/kis/test")
    assert r.json()["server"] == "vps"


def test_changing_keys_rebuilds_services(deps: Any) -> None:
    configure(deps)
    first = get_kis(deps)
    deps.secrets.set(SecretName.KIS_APP_KEY, "ak-2")
    assert get_kis(deps) is not first


def test_reprs_do_not_leak_secrets(deps: Any) -> None:
    """디버그 출력이나 예외 메시지로 키가 새면 안 된다 (리뷰 Important #6)."""
    deps.secrets.set(SecretName.KIS_APP_KEY, "ak-visible-123")
    deps.secrets.set(SecretName.KIS_APP_SECRET, "as-secret-456")
    services = get_kis(deps)
    for text in (repr(services), repr(deps)):
        assert "as-secret-456" not in text and "ak-visible-123" not in text
        assert "test-token" not in text  # 사이드카 인증 토큰도 마찬가지
