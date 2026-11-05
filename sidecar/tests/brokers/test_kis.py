"""한투 보유 조회 어댑터 (v2 설계 1, 8장). 응답은 공식 샘플의 필드 이름을 따른다."""

from decimal import Decimal
from typing import Any

import httpx
import pytest
import respx

from vater_core.api.errors import VaterError
from vater_core.brokers.base import ADAPTERS, BrokerContext, BrokerCreds
from vater_core.brokers.kis import DOMESTIC_PATH, MAX_PAGES, OVERSEAS_PATH, KisAdapter
from vater_core.kis.client import KisClient
from vater_core.kis.config import REST_HOST, KisCredentials, KisServer
from vater_core.kis.ratelimit import PriorityRateLimiter
from vater_core.store.holdings import HoldingRow

ACCOUNT = "12345678-01"


class Tokens:
    async def token(self) -> str:
        return "tok"

    async def invalidate(self, rejected: str | None = None) -> None:
        pass


def ok(**extra: Any) -> dict[str, Any]:
    return {"rt_cd": "0", "msg_cd": "MCA00000", "msg1": "정상", **extra}


def domestic(code: str, name: str, qty: str, avg: str = "70000.0000") -> dict[str, str]:
    return {"pdno": code, "prdt_name": name, "hldg_qty": qty, "pchs_avg_pric": avg}


def adapter(
    http: httpx.AsyncClient, account: str | None = ACCOUNT, server: KisServer = KisServer.PROD
) -> KisAdapter:
    creds = KisCredentials(app_key="ak", app_secret="as", hts_id=None)
    client = KisClient(http, Tokens(), creds, server, PriorityRateLimiter(1000))
    ctx = BrokerContext(
        BrokerCreds(1, "ak", "as", account),
        None,  # type: ignore[arg-type]  # 토큰은 KisClient가 관리한다
        lambda base, allowed: pytest.fail("한투는 ReadOnlyHttp를 쓰지 않는다"),
        kis=client,
    )
    return KisAdapter(ctx)


def mock_routes(
    host: str = REST_HOST[KisServer.PROD],
    kr: list[dict[str, str]] | None = None,
    abroad: list[dict[str, str]] | None = None,
) -> tuple[respx.Route, respx.Route]:
    return (
        respx.get(host + DOMESTIC_PATH).mock(
            return_value=httpx.Response(200, json=ok(output1=kr or [], output2=[]))
        ),
        respx.get(host + OVERSEAS_PATH).mock(
            return_value=httpx.Response(200, json=ok(output1=abroad or [], output2=[]))
        ),
    )


def test_registered() -> None:
    assert ADAPTERS["kis"] is KisAdapter


@respx.mock
async def test_domestic_fields_and_request() -> None:
    dom, _ = mock_routes(
        kr=[domestic("005930", "삼성전자", "10"), domestic("069500", "KODEX 200", "3", "35000")]
    )
    async with httpx.AsyncClient() as http:
        rows = await adapter(http).holdings()
    assert rows[:2] == [
        HoldingRow("KR", "005930", "삼성전자", Decimal(10), Decimal(70000), "KRW"),
        HoldingRow("KR", "069500", "KODEX 200", Decimal(3), Decimal(35000), "KRW"),
    ]
    request = dom.calls.last.request
    assert request.headers["tr_id"] == "TTTC8434R"
    params = request.url.params
    assert (params["CANO"], params["ACNT_PRDT_CD"]) == ("12345678", "01")
    assert params["INQR_DVSN"] == "02"  # 종목별. 대출일별이면 같은 종목이 나뉜다
    required = "AFHR_FLPR_YN OFL_YN UNPR_DVSN FUND_STTL_ICLD_YN FNCG_AMT_AUTO_RDPT_YN PRCS_DVSN"
    assert all(name in params for name in required.split())
    assert "CTX_AREA_FK100" in params and "CTX_AREA_NK100" in params


@respx.mock
async def test_all_pages_are_read() -> None:
    host = REST_HOST[KisServer.PROD]
    first = httpx.Response(
        200,
        headers={"tr_cont": "F"},
        json=ok(
            output1=[domestic("005930", "삼성전자", "1")], ctx_area_fk100="F1", ctx_area_nk100="N1"
        ),
    )
    last = httpx.Response(
        200,
        headers={"tr_cont": "D"},
        json=ok(
            output1=[domestic("000660", "SK하이닉스", "2")],
            ctx_area_fk100="F2",
            ctx_area_nk100="N2",
        ),
    )
    dom = respx.get(host + DOMESTIC_PATH).mock(side_effect=[first, last])
    respx.get(host + OVERSEAS_PATH).mock(return_value=httpx.Response(200, json=ok(output1=[])))
    async with httpx.AsyncClient() as http:
        rows = await adapter(http).holdings()
    assert [r.code for r in rows] == ["005930", "000660"]
    second = dom.calls[1].request
    assert second.headers["tr_cont"] == "N"
    assert (second.url.params["CTX_AREA_FK100"], second.url.params["CTX_AREA_NK100"]) == (
        "F1",
        "N1",
    )


@respx.mock
async def test_endless_paging_fails_instead_of_saving_a_partial_list() -> None:
    respx.get(REST_HOST[KisServer.PROD] + DOMESTIC_PATH).mock(
        return_value=httpx.Response(200, headers={"tr_cont": "M"}, json=ok(output1=[]))
    )
    async with httpx.AsyncClient() as http:
        with pytest.raises(VaterError) as e:
            await adapter(http).holdings()
    assert e.value.code == "BROKER_RESPONSE_INVALID"
    assert respx.calls.call_count == MAX_PAGES


@respx.mock
async def test_mock_server_uses_mock_tr() -> None:
    dom, abroad = mock_routes(REST_HOST[KisServer.VPS])
    async with httpx.AsyncClient() as http:
        await adapter(http, server=KisServer.VPS).holdings()
    assert dom.calls.last.request.headers["tr_id"] == "VTTC8434R"
    assert abroad.calls.last.request.headers["tr_id"] == "VTRP6504R"


@pytest.mark.parametrize("account", [None, "", "1234567", "123456789", "12345678-012"])
@respx.mock
async def test_bad_account_format_is_refused_before_any_call(account: str | None) -> None:
    async with httpx.AsyncClient() as http:
        with pytest.raises(VaterError) as e:
            await adapter(http, account).test()
    assert e.value.code == "BROKER_ACCOUNT_INVALID"
    assert respx.calls.call_count == 0


@respx.mock
async def test_rejected_account_says_so_in_the_connection_test() -> None:
    respx.get(REST_HOST[KisServer.PROD] + DOMESTIC_PATH).mock(
        return_value=httpx.Response(
            200,
            json={"rt_cd": "7", "msg_cd": "OPSQ2000", "msg1": "ERROR : INPUT INVALID_CHECK_ACNO"},
        )
    )
    async with httpx.AsyncClient() as http:
        with pytest.raises(VaterError) as e:
            await adapter(http).test()
    assert e.value.code == "BROKER_ACCOUNT_INVALID"
    assert e.value.hint and "계좌번호" in e.value.hint


@respx.mock
async def test_other_tr_is_blocked_before_sending() -> None:
    async with httpx.AsyncClient() as http:
        with pytest.raises(VaterError) as e:
            await adapter(http)._pages(
                "/uapi/domestic-stock/v1/trading/order-cash", "TTTC0012U", {}, "100"
            )
    assert e.value.code == "BROKER_CALL_BLOCKED"
    assert respx.calls.call_count == 0


def abroad(
    code: str, exchange: str, country: str, currency: str, qty: str, avg: str
) -> dict[str, str]:
    return {
        "pdno": code,
        "prdt_name": code + " 이름",
        "ccld_qty_smtl1": qty,
        "cblc_qty13": "999",
        "avg_unpr3": avg,
        "ovrs_excg_cd": exchange,
        "natn_kor_name": country,
        "buy_crcy_cd": currency,
    }


@respx.mock
async def test_overseas_fractional_us_and_other_markets() -> None:
    _, route = mock_routes(
        abroad=[
            abroad("AAPL", "NASD", "미국", "USD", "1.5", "150.25"),
            abroad("7203", "TKSE", "일본", "JPY", "100", "2500"),
        ]
    )
    async with httpx.AsyncClient() as http:
        rows = await adapter(http).holdings()
    assert rows == [
        HoldingRow("US", "AAPL", "AAPL 이름", Decimal("1.5"), Decimal("150.25"), "USD"),
        HoldingRow(None, "7203", "7203 이름", Decimal(100), Decimal(2500), "JPY"),
    ]
    request = route.calls.last.request
    assert request.headers["tr_id"] == "CTRP6504R"
    params = request.url.params
    assert (params["CANO"], params["ACNT_PRDT_CD"]) == ("12345678", "01")
    assert params["WCRC_FRCR_DVSN_CD"] == "02"  # 외화. 원화면 평단가가 환산값이 된다
    assert (params["NATN_CD"], params["TR_MKET_CD"], params["INQR_DVSN_CD"]) == ("000", "00", "00")


@respx.mock
async def test_blank_number_fails_rather_than_guessing() -> None:
    mock_routes(kr=[domestic("005930", "삼성전자", "")])
    async with httpx.AsyncClient() as http:
        with pytest.raises(VaterError) as e:
            await adapter(http).holdings()
    assert e.value.code == "BROKER_RESPONSE_INVALID"
