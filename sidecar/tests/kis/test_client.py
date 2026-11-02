from typing import Any

import httpx
import pytest
import respx

from vater_core.api.errors import VaterError
from vater_core.kis.client import KisApiError, KisClient
from vater_core.kis.config import REST_HOST, KisCredentials, KisServer
from vater_core.kis.ratelimit import PriorityRateLimiter

HOST = REST_HOST[KisServer.PROD]
PATH = "/uapi/domestic-stock/v1/quotations/inquire-price"
URL = HOST + PATH


class FakeTokens:
    def __init__(self) -> None:
        self.invalidated = 0
        self.current = "tok-1"

    async def token(self) -> str:
        return self.current

    async def invalidate(self) -> None:
        self.invalidated += 1
        self.current = "tok-2"


def client(http: httpx.AsyncClient, tokens: FakeTokens) -> KisClient:
    creds = KisCredentials(app_key="ak", app_secret="as", hts_id=None)
    return KisClient(http, tokens, creds, KisServer.PROD, PriorityRateLimiter(1000),
                     retry_delays=(0, 0, 0))  # fmt: skip


def body(rt_cd: str = "0", msg_cd: str = "MCA00000", msg1: str = "정상처리 되었습니다.",
         **extra: Any) -> dict[str, Any]:  # fmt: skip
    return {"rt_cd": rt_cd, "msg_cd": msg_cd, "msg1": msg1, **extra}


async def call(tokens: FakeTokens | None = None) -> dict[str, Any]:
    async with httpx.AsyncClient() as http:
        return await client(http, tokens or FakeTokens()).get(
            PATH, "FHKST01010100", {"FID_COND_MRKT_DIV_CODE": "J", "FID_INPUT_ISCD": "005930"}
        )


@respx.mock
async def test_sends_required_headers_and_params() -> None:
    route = respx.get(URL).mock(
        return_value=httpx.Response(200, json=body(output={"stck_prpr": "1"}))
    )
    assert (await call())["output"] == {"stck_prpr": "1"}
    req = route.calls[0].request
    assert req.headers["authorization"] == "Bearer tok-1"
    assert req.headers["appkey"] == "ak" and req.headers["appsecret"] == "as"
    assert req.headers["tr_id"] == "FHKST01010100" and req.headers["custtype"] == "P"
    assert req.url.params["FID_INPUT_ISCD"] == "005930"


@respx.mock
async def test_business_error_maps_to_kis_api_error() -> None:
    respx.get(URL).mock(
        return_value=httpx.Response(200, json=body("1", "OPSQ2001", "종목코드 오류"))
    )
    with pytest.raises(KisApiError) as e:
        await call()
    assert e.value.code == "KIS_API_ERROR" and "종목코드 오류" in e.value.message
    assert e.value.msg_cd == "OPSQ2001" and e.value.status == 502


@respx.mock
async def test_rate_limit_retries_then_succeeds() -> None:
    limited = httpx.Response(500, json=body("1", "EGW00201", "초당 거래건수를 초과하였습니다."))
    route = respx.get(URL).mock(
        side_effect=[limited, limited, httpx.Response(200, json=body(output={}))]
    )
    await call()
    assert route.call_count == 3


@respx.mock
async def test_rate_limit_gives_up_after_three_retries() -> None:
    limited = httpx.Response(500, json=body("1", "EGW00201", "초당 거래건수를 초과하였습니다."))
    route = respx.get(URL).mock(return_value=limited)
    with pytest.raises(VaterError) as e:
        await call()
    assert e.value.code == "KIS_RATE_LIMITED" and route.call_count == 4


@respx.mock
async def test_expired_token_is_refreshed_once() -> None:
    expired = httpx.Response(500, json=body("1", "EGW00123", "기간이 만료된 token 입니다."))
    route = respx.get(URL).mock(side_effect=[expired, httpx.Response(200, json=body(output={}))])
    tokens = FakeTokens()
    await call(tokens)
    assert tokens.invalidated == 1 and route.call_count == 2
    assert route.calls[1].request.headers["authorization"] == "Bearer tok-2"


@respx.mock
async def test_repeated_auth_failure_maps_to_auth_invalid() -> None:
    respx.get(URL).mock(return_value=httpx.Response(401, json={}))
    with pytest.raises(VaterError) as e:
        await call()
    assert e.value.code == "KIS_AUTH_INVALID"


@respx.mock
async def test_network_error_maps_to_unreachable() -> None:
    respx.get(URL).mock(side_effect=httpx.ConnectError("down"))
    with pytest.raises(VaterError) as e:
        await call()
    assert e.value.code == "KIS_UNREACHABLE"


def test_client_has_no_write_methods() -> None:
    for name in ("post", "put", "delete", "patch", "order"):
        assert not hasattr(KisClient, name), name
