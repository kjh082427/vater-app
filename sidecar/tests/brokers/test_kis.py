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


EMPTY_KR = ok(output1=[], output2=[{"scts_evlu_amt": "0"}])
EMPTY_ABROAD = ok(output1=[], output2=[], output3={"evlu_amt_smtl": "0"})


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
            return_value=httpx.Response(200, json=ok(output1=kr) if kr else EMPTY_KR)
        ),
        respx.get(host + OVERSEAS_PATH).mock(
            return_value=httpx.Response(200, json=ok(output1=abroad) if abroad else EMPTY_ABROAD)
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
    respx.get(host + OVERSEAS_PATH).mock(return_value=httpx.Response(200, json=EMPTY_ABROAD))
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
    pages = iter(range(1000))

    def page(request: httpx.Request) -> httpx.Response:
        n = next(pages)
        row = domestic(f"{n:06d}", "종목", "1")
        return httpx.Response(
            200,
            headers={"tr_cont": "M"},
            json=ok(output1=[row], ctx_area_fk100=f"F{n}", ctx_area_nk100=f"N{n}"),
        )

    respx.get(REST_HOST[KisServer.PROD] + DOMESTIC_PATH).mock(side_effect=page)
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
async def test_other_kis_errors_are_not_called_account_errors() -> None:
    respx.get(REST_HOST[KisServer.PROD] + DOMESTIC_PATH).mock(return_value=httpx.Response(503))
    async with httpx.AsyncClient() as http:
        with pytest.raises(VaterError) as e:
            await adapter(http).test()
    assert e.value.code == "KIS_API_ERROR"


@respx.mock
async def test_connection_test_also_runs_the_overseas_call() -> None:
    respx.get(REST_HOST[KisServer.PROD] + DOMESTIC_PATH).mock(
        return_value=httpx.Response(200, json=EMPTY_KR)
    )
    route = respx.get(REST_HOST[KisServer.PROD] + OVERSEAS_PATH).mock(
        return_value=httpx.Response(200, json={"rt_cd": "1", "msg_cd": "X", "msg1": "점검"})
    )
    async with httpx.AsyncClient() as http:
        with pytest.raises(VaterError):
            await adapter(http).test()
    assert route.called


@respx.mock
async def test_only_general_accounts_are_accepted() -> None:
    async with httpx.AsyncClient() as http:
        with pytest.raises(VaterError) as e:
            await adapter(http, "12345678-29").test()  # 연금은 조회 TR이 다르다
    assert e.value.code == "BROKER_ACCOUNT_INVALID"
    assert "01" in e.value.message
    assert respx.calls.call_count == 0


@pytest.mark.parametrize("missing", [{}, {"output1": None}, {"output1": ""}, {"output1": {}}])
@respx.mock
async def test_missing_list_never_means_everything_was_sold(missing: dict[str, Any]) -> None:
    respx.get(REST_HOST[KisServer.PROD] + DOMESTIC_PATH).mock(
        return_value=httpx.Response(200, json=ok(output2=[{"scts_evlu_amt": "0"}], **missing))
    )
    async with httpx.AsyncClient() as http:
        with pytest.raises(VaterError) as e:
            await adapter(http).holdings()
    assert e.value.code == "BROKER_RESPONSE_INVALID"


@pytest.mark.parametrize(
    ("kr", "abroad_body"),
    [
        (ok(output1=[], output2=[{"scts_evlu_amt": "1000"}]), EMPTY_ABROAD),
        (ok(output1=[], output2=[]), EMPTY_ABROAD),
        (EMPTY_KR, ok(output1=[], output2=[], output3={"evlu_amt_smtl": "5.5"})),
        (EMPTY_KR, ok(output1=[], output2=[])),
    ],
)
async def test_empty_list_needs_a_zero_total(
    kr: dict[str, Any], abroad_body: dict[str, Any]
) -> None:
    host = REST_HOST[KisServer.PROD]
    with respx.mock(assert_all_called=False) as router:
        router.get(host + DOMESTIC_PATH).mock(return_value=httpx.Response(200, json=kr))
        router.get(host + OVERSEAS_PATH).mock(return_value=httpx.Response(200, json=abroad_body))
        async with httpx.AsyncClient() as http:
            with pytest.raises(VaterError) as e:
                await adapter(http).holdings()
    assert e.value.code == "BROKER_RESPONSE_INVALID"


@respx.mock
async def test_real_empty_account_shape_is_zero_rows() -> None:
    mock_routes()
    async with httpx.AsyncClient() as http:
        assert await adapter(http).holdings() == []


@pytest.mark.parametrize(
    ("fk", "nk"), [("", ""), ("F0", "N0")], ids=["empty context", "unchanged context"]
)
@respx.mock
async def test_bad_continuation_context_fails(fk: str, nk: str) -> None:
    respx.get(REST_HOST[KisServer.PROD] + DOMESTIC_PATH).mock(
        side_effect=[
            httpx.Response(
                200,
                headers={"tr_cont": "M"},
                json=ok(
                    output1=[domestic("005930", "삼성전자", "1")],
                    ctx_area_fk100="F0",
                    ctx_area_nk100="N0",
                ),
            ),
            httpx.Response(
                200,
                headers={"tr_cont": "M"},
                json=ok(
                    output1=[domestic("000660", "SK하이닉스", "1")],
                    ctx_area_fk100=fk,
                    ctx_area_nk100=nk,
                ),
            ),
        ]
    )
    async with httpx.AsyncClient() as http:
        with pytest.raises(VaterError) as e:
            await adapter(http).holdings()
    assert e.value.code == "BROKER_RESPONSE_INVALID"


@respx.mock
async def test_page_repeating_a_row_fails_instead_of_doubling() -> None:
    host = REST_HOST[KisServer.PROD]
    row = {**domestic("AAPL", "애플", "0"), "ccld_qty_smtl1": "2", "avg_unpr3": "100",
           "ovrs_excg_cd": "NASD", "buy_crcy_cd": "USD"}  # fmt: skip
    respx.get(host + DOMESTIC_PATH).mock(return_value=httpx.Response(200, json=EMPTY_KR))
    respx.get(host + OVERSEAS_PATH).mock(
        return_value=httpx.Response(200, headers={"tr_cont": "M"}, json=ok(output1=[row]))
    )
    async with httpx.AsyncClient() as http:
        with pytest.raises(VaterError) as e:
            await adapter(http).holdings()
    assert e.value.code == "BROKER_RESPONSE_INVALID"


@respx.mock
async def test_blank_average_means_unknown_not_failure() -> None:
    mock_routes(kr=[domestic("005930", "삼성전자", "10", "")])
    async with httpx.AsyncClient() as http:
        rows = await adapter(http).holdings()
    assert rows[0].avg_price is None and rows[0].quantity == 10


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
