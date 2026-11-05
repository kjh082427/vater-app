"""메리츠 보유 조회 어댑터 (v2 설계 1, 8장). 응답은 메리츠 공식 카탈로그의 모양을 따른다."""

from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx

from vater_core.api.errors import VaterError
from vater_core.brokers import meritz
from vater_core.brokers.base import ADAPTERS, BrokerContext, BrokerCreds
from vater_core.brokers.meritz import (
    BASE_URL,
    KR_PATH,
    MAX_PAGES,
    TOKEN_PATH,
    US_PATH,
    MeritzAdapter,
    mac_address,
)
from vater_core.brokers.readonly import ReadOnlyHttp
from vater_core.secrets.names import broker_secret
from vater_core.secrets.store import EnvFileSecretStore, SecretStore
from vater_core.store.holdings import HoldingRow

TOKEN_NAME = broker_secret(1, "TOKEN")
TOKEN_URL = BASE_URL + TOKEN_PATH
KR_URL = BASE_URL + KR_PATH
US_URL = BASE_URL + US_PATH
MAC = "AABBCCDDEEFF"
ISSUED = {"access_token": "tok-1", "token_type": "Bearer", "expires_in": 43200, "scope": "login"}
EMPTY = {"rsp_cd": "5820", "rsp_msg": "해당 자료가 없습니다.", "data": []}


def ok(data: Any, **extra: Any) -> dict[str, Any]:
    return {"rsp_cd": "0000", "rsp_msg": "정상", "data": data, **extra}


def kr_row(code: str = "A005930", qty: Any = 10, kind: str = "1") -> dict[str, Any]:
    return {
        "iscd": code,
        "isnm": "삼성전자",
        "pros_trgt_cls_code": kind,
        "mksc_cls_name": "주식일반",
        "rmnd_qty": qty,
        "hldn_issu_rmnd_qty": str(qty),
        "byng_unpr": "70000.00",
    }


def us_row(
    symbol: str = "AAPL", currency: str = "USD", qty: str = "1.5000000000"
) -> dict[str, str]:
    return {
        "iscd": f"{symbol}.OQ",
        "ovrs_stck_symb_iscd": symbol,
        "isnm": "애플",
        "rmnd_dqty": qty,
        "avrg_unpr": "150.250000",
        "crcd": currency,
    }


@pytest.fixture(autouse=True)
def _fixed_mac(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(meritz, "mac_address", lambda: MAC)
    monkeypatch.setattr(meritz, "PAGE_DELAY_SEC", 0)


@pytest.fixture
def secrets(tmp_path: Path) -> SecretStore:
    return EnvFileSecretStore(tmp_path / ".env")


def adapter(http: httpx.AsyncClient, secrets: SecretStore) -> MeritzAdapter:
    return MeritzAdapter(
        BrokerContext(
            BrokerCreds(1, "app-key", "app-secret", None),
            secrets,
            lambda base, allowed: ReadOnlyHttp(http, base, allowed),
        )
    )


def routes(
    kr: dict[str, Any] = EMPTY, us: dict[str, Any] = EMPTY
) -> tuple[respx.Route, respx.Route, respx.Route]:
    return (
        respx.post(TOKEN_URL).mock(return_value=httpx.Response(200, json=ISSUED)),
        respx.get(KR_URL).mock(return_value=httpx.Response(200, json=kr)),
        respx.get(US_URL).mock(return_value=httpx.Response(200, json=us)),
    )


def test_registered() -> None:
    assert ADAPTERS["meritz"] is MeritzAdapter


def test_mac_address_format(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.undo()
    monkeypatch.setattr(meritz.uuid, "getnode", lambda: 0x001122334455)
    assert meritz.mac_address() == "001122334455"


def test_random_mac_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    """네트워크 장치를 못 읽으면 getnode는 멀티캐스트 비트가 켜진 임의 값을 준다."""
    monkeypatch.undo()
    monkeypatch.setattr(meritz.uuid, "getnode", lambda: 0x011122334455)
    with pytest.raises(VaterError) as e:
        mac_address()
    assert e.value.code == "BROKER_MAC_UNAVAILABLE"


@respx.mock
async def test_fields_headers_and_token(secrets: SecretStore) -> None:
    token, kr, us = routes(
        ok(
            [
                kr_row(),
                kr_row("A0088M0", 3),
                kr_row("AAPL.OQ", 2, "J"),  # 국내 목록에 함께 오는 해외 행은 빼고 해외 조회를 쓴다
            ]
        ),
        ok([us_row(), us_row("7203", "JPY")]),
    )
    async with httpx.AsyncClient() as http:
        rows = await adapter(http, secrets).holdings()
    assert rows == [
        HoldingRow("KR", "005930", "삼성전자", Decimal(10), Decimal("70000.00"), "KRW"),
        HoldingRow("KR", "0088M0", "삼성전자", Decimal(3), Decimal("70000.00"), "KRW"),
        HoldingRow("US", "AAPL", "애플", Decimal("1.5"), Decimal("150.25"), "USD"),
        HoldingRow(None, "7203", "애플", Decimal("1.5"), Decimal("150.25"), "JPY"),
    ]
    for route in (kr, us):
        headers = route.calls.last.request.headers
        assert headers["mac_address"] == MAC
        assert headers["authorization"] == "Bearer tok-1"
    assert kr.calls.last.request.url.params["nthn_rmnd_incu_yn"] == "N"
    sent = token.calls.last.request
    assert "mac_address" not in sent.headers  # 공식 명세상 토큰 발급에는 필요 없다
    assert sent.read() == (
        b"grant_type=client_credentials&client_id=app-key&client_secret=app-secret&scope=login"
    )
    assert sent.headers["content-type"] == "application/x-www-form-urlencoded"


@respx.mock
async def test_token_is_cached_across_adapters(secrets: SecretStore) -> None:
    token, _, _ = routes()
    async with httpx.AsyncClient() as http:
        await adapter(http, secrets).holdings()
        await adapter(http, secrets).holdings()
    assert token.call_count == 1 and secrets.get(TOKEN_NAME) == "tok-1"


@pytest.mark.parametrize(
    "rejected",
    [
        {"status_code": 401, "json": {}},
        {"status_code": 403, "json": {"rsp_cd": "EGW00123", "rsp_msg": "기간이 만료된 token"}},
        {"status_code": 200, "json": {"rsp_cd": "EGW00121", "rsp_msg": "유효하지 않은 token"}},
    ],
)
@respx.mock
async def test_dead_token_is_reissued_once(secrets: SecretStore, rejected: dict[str, Any]) -> None:
    secrets.set(TOKEN_NAME, "old")
    token = respx.post(TOKEN_URL).mock(return_value=httpx.Response(200, json=ISSUED))
    kr = respx.get(KR_URL).mock(
        side_effect=[httpx.Response(**rejected), httpx.Response(200, json=EMPTY)]
    )
    respx.get(US_URL).mock(return_value=httpx.Response(200, json=EMPTY))
    async with httpx.AsyncClient() as http:
        assert await adapter(http, secrets).holdings() == []
    assert token.call_count == 1
    assert kr.calls[1].request.headers["authorization"] == "Bearer tok-1"


@respx.mock
async def test_token_rejected_twice_means_lost(secrets: SecretStore) -> None:
    respx.post(TOKEN_URL).mock(return_value=httpx.Response(200, json=ISSUED))
    kr = respx.get(KR_URL).mock(
        return_value=httpx.Response(200, json={"rsp_cd": "EGW00123", "rsp_msg": "만료"})
    )
    async with httpx.AsyncClient() as http:
        with pytest.raises(VaterError) as e:
            await adapter(http, secrets).holdings()
    assert e.value.code == "BROKER_AUTH_INVALID" and kr.call_count == 2


@respx.mock
async def test_bad_key_at_token_time(secrets: SecretStore) -> None:
    respx.post(TOKEN_URL).mock(
        return_value=httpx.Response(
            403, json={"rsp_cd": "EGW00103", "rsp_msg": "유효하지 않은 client_id입니다."}
        )
    )
    async with httpx.AsyncClient() as http:
        with pytest.raises(VaterError) as e:
            await adapter(http, secrets).test()
    assert e.value.code == "BROKER_AUTH_INVALID"
    assert "client_id" in e.value.message
    assert secrets.get(TOKEN_NAME) is None


@respx.mock
async def test_missing_mac_response_explains_itself(secrets: SecretStore) -> None:
    secrets.set(TOKEN_NAME, "tok")
    respx.get(KR_URL).mock(
        return_value=httpx.Response(400, json={"rsp_cd": "IGW50024", "rsp_msg": "mac_address 없음"})
    )
    async with httpx.AsyncClient() as http:
        with pytest.raises(VaterError) as e:
            await adapter(http, secrets).holdings()
    assert e.value.code == "BROKER_MAC_UNAVAILABLE"


@pytest.mark.parametrize(
    ("response", "code"),
    [
        (
            httpx.Response(500, json={"rsp_cd": "EGW00200", "rsp_msg": "초과"}),
            "BROKER_RATE_LIMITED",
        ),
        (httpx.Response(503), "BROKER_UNREACHABLE"),
        (httpx.Response(500, json={"rsp_cd": "EGW00002", "rsp_msg": "서버"}), "BROKER_UNREACHABLE"),
        (httpx.Response(500, json={"rsp_cd": "EGW00202", "rsp_msg": "권한"}), "BROKER_API_ERROR"),
        (httpx.Response(502, text="<html>proxy</html>"), "BROKER_UNREACHABLE"),
        (
            httpx.Response(
                500, json={"rsp_cd": "0760", "rsp_msg": "권한", "rsp_sub_msg": "관리점"}
            ),
            "BROKER_API_ERROR",
        ),
        (httpx.Response(200, text="<html>점검</html>"), "BROKER_RESPONSE_INVALID"),
    ],
)
@respx.mock
async def test_temporary_failures_are_not_auth_failures(
    secrets: SecretStore, response: httpx.Response, code: str
) -> None:
    secrets.set(TOKEN_NAME, "tok")
    respx.get(KR_URL).mock(return_value=response)
    async with httpx.AsyncClient() as http:
        with pytest.raises(VaterError) as e:
            await adapter(http, secrets).holdings()
    assert e.value.code == code


@respx.mock
async def test_all_pages_are_read(secrets: SecretStore) -> None:
    secrets.set(TOKEN_NAME, "tok")
    kr = respx.get(KR_URL).mock(
        side_effect=[
            httpx.Response(
                200,
                json={**ok([kr_row()]), "rsp_cd": "5762", "tr_cont": "1", "tr_cont_key": "K 1 "},
            ),
            httpx.Response(200, json=ok([kr_row("A000660")])),
        ]
    )
    respx.get(US_URL).mock(return_value=httpx.Response(200, json=EMPTY))
    async with httpx.AsyncClient() as http:
        rows = await adapter(http, secrets).holdings()
    assert [r.code for r in rows] == ["005930", "000660"]
    params = kr.calls[1].request.url.params
    assert (params["tr_cont"], params["tr_cont_key"]) == ("1", "K 1 ")  # 공백까지 그대로


@pytest.mark.parametrize("key", ["", None, "K0"])
@respx.mock
async def test_bad_continuation_key_fails(secrets: SecretStore, key: str | None) -> None:
    secrets.set(TOKEN_NAME, "tok")
    respx.get(KR_URL).mock(
        side_effect=[
            httpx.Response(200, json={**ok([kr_row()]), "rsp_cd": "5762", "tr_cont_key": "K0"}),
            httpx.Response(
                200, json={**ok([kr_row("A000660")]), "rsp_cd": "5762", "tr_cont_key": key}
            ),
        ]
    )
    async with httpx.AsyncClient() as http:
        with pytest.raises(VaterError) as e:
            await adapter(http, secrets).holdings()
    assert e.value.code == "BROKER_RESPONSE_INVALID"


@respx.mock
async def test_repeated_rows_and_endless_paging_fail(secrets: SecretStore) -> None:
    secrets.set(TOKEN_NAME, "tok")
    pages = iter(range(1000))

    def page(request: httpx.Request) -> httpx.Response:
        n = next(pages)
        body = {**ok([kr_row(f"A{n:06d}")]), "rsp_cd": "5762", "tr_cont_key": f"K{n}"}
        return httpx.Response(200, json=body)

    route = respx.get(KR_URL).mock(side_effect=page)
    async with httpx.AsyncClient() as http:
        with pytest.raises(VaterError) as e:
            await adapter(http, secrets).holdings()
    assert e.value.code == "BROKER_RESPONSE_INVALID"
    assert route.call_count == MAX_PAGES


@pytest.mark.parametrize(
    "body",
    [
        {"rsp_cd": "0000", "rsp_msg": "정상"},  # data 없음
        {"rsp_cd": "0000", "data": None},
        {"rsp_cd": "0000", "data": {}},
        {"data": []},  # 코드 없음
    ],
)
@respx.mock
async def test_missing_list_never_means_sold(secrets: SecretStore, body: dict[str, Any]) -> None:
    secrets.set(TOKEN_NAME, "tok")
    respx.get(KR_URL).mock(return_value=httpx.Response(200, json=body))
    async with httpx.AsyncClient() as http:
        with pytest.raises(VaterError) as e:
            await adapter(http, secrets).holdings()
    assert e.value.code == "BROKER_RESPONSE_INVALID"


@respx.mock
async def test_overseas_list_must_agree_with_the_mixed_domestic_list(secrets: SecretStore) -> None:
    """국내 목록에 해외 행이 있는데 해외 조회가 비면 응답을 믿지 않는다."""
    routes(ok([kr_row("AAPL.OQ", 2, "J")]), EMPTY)
    async with httpx.AsyncClient() as http:
        with pytest.raises(VaterError) as e:
            await adapter(http, secrets).holdings()
    assert e.value.code == "BROKER_RESPONSE_INVALID"


@respx.mock
async def test_connection_test_covers_both_lists(secrets: SecretStore) -> None:
    _, kr, us = routes()
    async with httpx.AsyncClient() as http:
        await adapter(http, secrets).test()
    assert kr.called and us.called


def test_only_read_calls_are_allowed() -> None:
    assert {("POST", TOKEN_PATH), ("GET", KR_PATH), ("GET", US_PATH)} == meritz._ALLOWED


@respx.mock
async def test_rows_arriving_with_a_no_data_code_are_kept(secrets: SecretStore) -> None:
    """이 게이트웨이는 자료를 담고도 5820을 보낼 때가 있다."""
    routes({**ok([kr_row()]), "rsp_cd": "5820"})
    async with httpx.AsyncClient() as http:
        rows = await adapter(http, secrets).holdings()
    assert [r.code for r in rows] == ["005930"]
