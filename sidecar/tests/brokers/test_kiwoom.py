"""키움 보유 조회 어댑터 (v2 설계 1, 8장). 응답은 공식 명세(kt00018, ust21070)의 모양을 따른다."""

from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx

from vater_core.api.errors import VaterError
from vater_core.brokers import kiwoom
from vater_core.brokers.base import ADAPTERS, BrokerContext, BrokerCreds
from vater_core.brokers.kiwoom import (
    BASE_URL,
    KR_PATH,
    MAX_PAGES,
    TOKEN_PATH,
    US_PATH,
    KiwoomAdapter,
)
from vater_core.brokers.readonly import ReadOnlyHttp
from vater_core.secrets.names import broker_secret
from vater_core.secrets.store import EnvFileSecretStore, SecretStore
from vater_core.store.holdings import HoldingRow

TOKEN_NAME = broker_secret(1, "TOKEN")
TOKEN_URL = BASE_URL + TOKEN_PATH
KR_URL = BASE_URL + KR_PATH
US_URL = BASE_URL + US_PATH
ISSUED = {
    "token": "tok-1",
    "expires_dt": "20991231235959",
    "token_type": "bearer",
    "return_code": 0,
}
ZERO = "000000000000000"


def ok(**extra: Any) -> dict[str, Any]:
    return {"return_code": 0, "return_msg": "정상적으로 처리되었습니다", **extra}


def kr_row(
    code: str = "A005930", name: str = "삼성전자", qty: str = "000000000000010"
) -> dict[str, str]:
    return {"stk_cd": code, "stk_nm": name, "rmnd_qty": qty, "pur_pric": "000000000070000"}


def us_row(code: str = "AAPL", qty: str = "000000000395", currency: str = "USD") -> dict[str, str]:
    return {
        "stk_cd": code,
        "frgn_stk_nm": "애플",
        "poss_qty": qty,
        "frgn_stk_book_uv": "282.1603",
        "crnc_code": currency,
    }


EMPTY_KR = ok(tot_evlt_amt=ZERO, acnt_evlt_remn_indv_tot=[])
EMPTY_US = ok(tot_evlt_amt="0.0000", result_list=[])


@pytest.fixture(autouse=True)
def _no_page_delay(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(kiwoom, "PAGE_DELAY_SEC", 0)


@pytest.fixture
def secrets(tmp_path: Path) -> SecretStore:
    return EnvFileSecretStore(tmp_path / ".env")


def adapter(http: httpx.AsyncClient, secrets: SecretStore) -> KiwoomAdapter:
    return KiwoomAdapter(
        BrokerContext(
            BrokerCreds(1, "app-key", "secret-key", None),
            secrets,
            lambda base, allowed: ReadOnlyHttp(http, base, allowed),
        )
    )


def routes(
    kr: dict[str, Any] = EMPTY_KR, us: dict[str, Any] = EMPTY_US
) -> tuple[respx.Route, respx.Route, respx.Route]:
    return (
        respx.post(TOKEN_URL).mock(return_value=httpx.Response(200, json=ISSUED)),
        respx.post(KR_URL).mock(return_value=httpx.Response(200, json=kr)),
        respx.post(US_URL).mock(return_value=httpx.Response(200, json=us)),
    )


def test_registered() -> None:
    assert ADAPTERS["kiwoom"] is KiwoomAdapter


@respx.mock
async def test_fields_prefix_and_requests(secrets: SecretStore) -> None:
    token, kr, us = routes(
        ok(
            tot_evlt_amt="000000025789890",
            acnt_evlt_remn_indv_tot=[
                kr_row(),
                kr_row("A0088M0", "메쎄이상", "000000000000003"),
                kr_row("Q530001", "어떤 ETN", "000000000000001"),
            ],
        ),
        ok(tot_evlt_amt="156464.6701", result_list=[us_row(qty="000000000001.5")]),
    )
    async with httpx.AsyncClient() as http:
        rows = await adapter(http, secrets).holdings()
    assert rows == [
        HoldingRow("KR", "005930", "삼성전자", Decimal(10), Decimal(70000), "KRW"),
        HoldingRow("KR", "0088M0", "메쎄이상", Decimal(3), Decimal(70000), "KRW"),
        HoldingRow("KR", "530001", "어떤 ETN", Decimal(1), Decimal(70000), "KRW"),
        HoldingRow("US", "AAPL", "애플", Decimal("1.5"), Decimal("282.1603"), "USD"),
    ]
    assert kr.calls.last.request.headers["api-id"] == "kt00018"
    assert kr.calls.last.request.headers["authorization"] == "Bearer tok-1"
    assert kr.calls.last.request.read() == b'{"qry_tp":"1","dmst_stex_tp":"KRX"}'
    assert us.calls.last.request.headers["api-id"] == "ust21070"
    assert token.calls.last.request.read() == (
        b'{"grant_type":"client_credentials","appkey":"app-key","secretkey":"secret-key"}'
    )


@respx.mock
async def test_token_is_cached_across_adapters(secrets: SecretStore) -> None:
    token, _, _ = routes()
    async with httpx.AsyncClient() as http:
        await adapter(http, secrets).holdings()
        await adapter(http, secrets).holdings()
    assert token.call_count == 1
    assert secrets.get(TOKEN_NAME) == "tok-1"


@pytest.mark.parametrize(
    "rejected",
    [
        {"status_code": 401, "json": {}},
        {
            "status_code": 200,
            "json": {"return_code": 8005, "return_msg": "Token이 유효하지 않습니다"},
        },
        {
            "status_code": 200,
            "json": {"return_code": 3, "return_msg": "[8005:Token이 유효하지 않습니다]"},
        },
        {
            "status_code": 200,
            "json": {"return_code": "8010", "return_msg": "IP 불일치"},
        },
    ],
)
@respx.mock
async def test_rejected_token_is_reissued_once(
    secrets: SecretStore, rejected: dict[str, Any]
) -> None:
    secrets.set(TOKEN_NAME, "old")
    token = respx.post(TOKEN_URL).mock(return_value=httpx.Response(200, json=ISSUED))
    kr = respx.post(KR_URL).mock(
        side_effect=[httpx.Response(**rejected), httpx.Response(200, json=EMPTY_KR)]
    )
    respx.post(US_URL).mock(return_value=httpx.Response(200, json=EMPTY_US))
    async with httpx.AsyncClient() as http:
        assert await adapter(http, secrets).holdings() == []
    assert token.call_count == 1
    assert kr.calls[0].request.headers["authorization"] == "Bearer old"
    assert kr.calls[1].request.headers["authorization"] == "Bearer tok-1"


@respx.mock
async def test_token_rejected_twice_means_the_connection_is_lost(secrets: SecretStore) -> None:
    respx.post(TOKEN_URL).mock(return_value=httpx.Response(200, json=ISSUED))
    kr = respx.post(KR_URL).mock(
        return_value=httpx.Response(200, json={"return_code": 8005, "return_msg": "Token"})
    )
    async with httpx.AsyncClient() as http:
        with pytest.raises(VaterError) as e:
            await adapter(http, secrets).holdings()
    assert e.value.code == "BROKER_AUTH_INVALID"
    assert e.value.hint and "다른 프로그램" in e.value.hint  # 계좌별 세션 1개 제한
    assert kr.call_count == 2


@respx.mock
async def test_bad_or_terminated_key_tells_how_to_apply_again(secrets: SecretStore) -> None:
    respx.post(TOKEN_URL).mock(
        return_value=httpx.Response(
            200,
            json={"return_code": 8001, "return_msg": "App Key와 Secret Key 검증에 실패했습니다"},
        )
    )
    async with httpx.AsyncClient() as http:
        with pytest.raises(VaterError) as e:
            await adapter(http, secrets).test()
    assert e.value.code == "BROKER_AUTH_INVALID"
    assert e.value.hint and "3개월" in e.value.hint and "재신청" in e.value.hint
    assert secrets.get(TOKEN_NAME) is None


@pytest.mark.parametrize(
    ("response", "code"),
    [
        (httpx.Response(429, json={"return_code": 5, "return_msg": "초과"}), "BROKER_RATE_LIMITED"),
        (
            httpx.Response(200, json={"return_code": 1700, "return_msg": "초과"}),
            "BROKER_RATE_LIMITED",
        ),
        (httpx.Response(503), "BROKER_UNREACHABLE"),
        (httpx.Response(200, json={"return_code": 1999, "return_msg": "점검"}), "BROKER_API_ERROR"),
        (httpx.Response(200, text="<html>점검</html>"), "BROKER_RESPONSE_INVALID"),
    ],
)
@respx.mock
async def test_temporary_failures_are_not_auth_failures(
    secrets: SecretStore, response: httpx.Response, code: str
) -> None:
    secrets.set(TOKEN_NAME, "tok")
    respx.post(KR_URL).mock(return_value=response)
    async with httpx.AsyncClient() as http:
        with pytest.raises(VaterError) as e:
            await adapter(http, secrets).holdings()
    assert e.value.code == code


@respx.mock
async def test_all_pages_are_read(secrets: SecretStore) -> None:
    secrets.set(TOKEN_NAME, "tok")
    kr = respx.post(KR_URL).mock(
        side_effect=[
            httpx.Response(
                200,
                headers={"cont-yn": "Y", "next-key": "K1"},
                json=ok(tot_evlt_amt="1", acnt_evlt_remn_indv_tot=[kr_row()]),
            ),
            httpx.Response(
                200,
                headers={"cont-yn": "N"},
                json=ok(
                    tot_evlt_amt="1", acnt_evlt_remn_indv_tot=[kr_row("A000660", "SK하이닉스")]
                ),
            ),
        ]
    )
    respx.post(US_URL).mock(return_value=httpx.Response(200, json=EMPTY_US))
    async with httpx.AsyncClient() as http:
        rows = await adapter(http, secrets).holdings()
    assert [r.code for r in rows] == ["005930", "000660"]
    second = kr.calls[1].request.headers
    assert (second["cont-yn"], second["next-key"]) == ("Y", "K1")


@pytest.mark.parametrize(
    "bad",
    [
        {"cont-yn": "Y"},  # next-key 없음
        {"cont-yn": "Y", "next-key": "K0"},  # 그대로
    ],
)
@respx.mock
async def test_bad_continuation_fails(secrets: SecretStore, bad: dict[str, str]) -> None:
    secrets.set(TOKEN_NAME, "tok")
    respx.post(KR_URL).mock(
        side_effect=[
            httpx.Response(
                200,
                headers={"cont-yn": "Y", "next-key": "K0"},
                json=ok(tot_evlt_amt="1", acnt_evlt_remn_indv_tot=[kr_row()]),
            ),
            httpx.Response(
                200,
                headers=bad,
                json=ok(tot_evlt_amt="1", acnt_evlt_remn_indv_tot=[kr_row("A000660")]),
            ),
        ]
    )
    async with httpx.AsyncClient() as http:
        with pytest.raises(VaterError) as e:
            await adapter(http, secrets).holdings()
    assert e.value.code == "BROKER_RESPONSE_INVALID"


@respx.mock
async def test_repeated_row_or_endless_paging_fails(secrets: SecretStore) -> None:
    secrets.set(TOKEN_NAME, "tok")
    pages = iter(range(1000))

    def page(request: httpx.Request) -> httpx.Response:
        n = next(pages)
        return httpx.Response(
            200,
            headers={"cont-yn": "Y", "next-key": f"K{n}"},
            json=ok(tot_evlt_amt="1", acnt_evlt_remn_indv_tot=[kr_row(f"A{n:06d}")]),
        )

    route = respx.post(KR_URL).mock(side_effect=page)
    async with httpx.AsyncClient() as http:
        with pytest.raises(VaterError) as e:
            await adapter(http, secrets).holdings()
    assert e.value.code == "BROKER_RESPONSE_INVALID"
    assert route.call_count == MAX_PAGES


@pytest.mark.parametrize(
    "body",
    [
        ok(tot_evlt_amt=ZERO),  # 목록 없음
        ok(tot_evlt_amt=ZERO, acnt_evlt_remn_indv_tot=None),
        ok(tot_evlt_amt="000000025789890", acnt_evlt_remn_indv_tot=[]),  # 합계가 0이 아니다
        ok(acnt_evlt_remn_indv_tot=[]),  # 합계 없음
    ],
)
@respx.mock
async def test_empty_response_never_means_sold_without_a_zero_total(
    secrets: SecretStore, body: dict[str, Any]
) -> None:
    secrets.set(TOKEN_NAME, "tok")
    respx.post(KR_URL).mock(return_value=httpx.Response(200, json=body))
    async with httpx.AsyncClient() as http:
        with pytest.raises(VaterError) as e:
            await adapter(http, secrets).holdings()
    assert e.value.code == "BROKER_RESPONSE_INVALID"


@respx.mock
async def test_empty_account_is_zero_rows_even_with_a_blank_total(secrets: SecretStore) -> None:
    routes(ok(tot_evlt_amt="", acnt_evlt_remn_indv_tot=[]))
    async with httpx.AsyncClient() as http:
        assert await adapter(http, secrets).holdings() == []


@respx.mock
async def test_non_usd_row_is_marked_unsupported(secrets: SecretStore) -> None:
    routes(us=ok(tot_evlt_amt="1", result_list=[us_row("7203", currency="JPY")]))
    async with httpx.AsyncClient() as http:
        rows = await adapter(http, secrets).holdings()
    assert (rows[0].market, rows[0].currency) == (None, "JPY")


@respx.mock
async def test_connection_test_covers_both_markets(secrets: SecretStore) -> None:
    _, kr, us = routes()
    async with httpx.AsyncClient() as http:
        await adapter(http, secrets).test()
    assert kr.called and us.called


def test_only_read_calls_are_allowed() -> None:
    assert {("POST", TOKEN_PATH), ("POST", KR_PATH), ("POST", US_PATH)} == kiwoom._ALLOWED
    assert kiwoom._API_IDS == {KR_PATH: "kt00018", US_PATH: "ust21070"}
