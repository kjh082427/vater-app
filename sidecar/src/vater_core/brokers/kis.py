"""한국투자증권 보유 조회 (v2 설계 1, 8장).

시세와 호출 한도를 함께 써야 해서 `ReadOnlyHttp` 대신 GET만 있는 `KisClient`를 쓴다.
쓰는 TR은 아래 표로 고정한다. 주문 TR은 넣지 않는다.
"""

import re
from decimal import Decimal, InvalidOperation
from typing import Any

from vater_core.api.errors import VaterError
from vater_core.brokers.base import ADAPTERS, BrokerContext, KisReader
from vater_core.kis.client import KisApiError
from vater_core.kis.config import KisServer, Priority
from vater_core.store.holdings import HoldingRow, bad_broker_response

DOMESTIC_PATH = "/uapi/domestic-stock/v1/trading/inquire-balance"
OVERSEAS_PATH = "/uapi/overseas-stock/v1/trading/inquire-present-balance"  # 체결 기준, 모든 국가
_TR = {
    DOMESTIC_PATH: {KisServer.PROD: "TTTC8434R", KisServer.VPS: "VTTC8434R"},
    OVERSEAS_PATH: {KisServer.PROD: "CTRP6504R", KisServer.VPS: "VTRP6504R"},
}
_ALLOWED = frozenset((path, tr) for path, trs in _TR.items() for tr in trs.values())
MAX_PAGES = 20  # 다 못 받으면 저장하지 않는다. 일부만 저장하면 나머지를 판 것으로 알게 된다
_MORE = ("F", "M")
_US_EXCHANGES = {"NASD", "NYSE", "AMEX"}


def _account_error(message: str) -> VaterError:
    return VaterError(
        "BROKER_ACCOUNT_INVALID",
        message,
        "계좌번호 10자리(앞 8자리와 뒤 2자리)를 확인해 주세요.",
        status=422,
    )


def _split_account(account: str | None) -> tuple[str, str]:
    digits = re.sub(r"\D", "", account or "")
    if len(digits) != 10:
        raise _account_error("계좌번호 형식이 올바르지 않습니다.")
    return digits[:8], digits[8:]


def _number(raw: Any) -> Decimal:
    try:
        return Decimal(str(raw))
    except InvalidOperation:
        raise bad_broker_response() from None


class KisAdapter:
    def __init__(self, ctx: BrokerContext) -> None:
        if ctx.kis is None:
            raise ValueError("KisAdapter needs the KIS client")
        self._kis: KisReader = ctx.kis
        self._account = ctx.creds.account

    async def _pages(
        self, path: str, tr_id: str, params: dict[str, str], ctx_size: str | None
    ) -> list[dict[str, Any]]:
        if (path, tr_id) not in _ALLOWED:
            raise VaterError(
                "BROKER_CALL_BLOCKED", f"허용되지 않은 증권사 호출입니다: {tr_id}", status=500
            )
        fk, nk = f"CTX_AREA_FK{ctx_size}", f"CTX_AREA_NK{ctx_size}"
        query = {**params, fk: "", nk: ""} if ctx_size else dict(params)
        rows: list[dict[str, Any]] = []
        tr_cont = ""
        for _ in range(MAX_PAGES):
            body, more = await self._kis.get_page(path, tr_id, query, Priority.BRIEFING, tr_cont)
            output = body.get("output1") or []
            rows += [output] if isinstance(output, dict) else output
            if more not in _MORE:
                return rows
            if ctx_size:
                query[fk], query[nk] = body.get(fk.lower(), ""), body.get(nk.lower(), "")
            tr_cont = "N"
        raise bad_broker_response()

    async def _domestic(self) -> list[dict[str, Any]]:
        cano, product = _split_account(self._account)
        return await self._pages(
            DOMESTIC_PATH,
            _TR[DOMESTIC_PATH][self._kis.server],
            {
                "CANO": cano,
                "ACNT_PRDT_CD": product,
                "AFHR_FLPR_YN": "N",
                "OFL_YN": "",
                "INQR_DVSN": "02",  # 종목별
                "UNPR_DVSN": "01",
                "FUND_STTL_ICLD_YN": "N",
                "FNCG_AMT_AUTO_RDPT_YN": "N",
                "PRCS_DVSN": "00",
            },
            "100",
        )

    async def _overseas(self) -> list[dict[str, Any]]:
        cano, product = _split_account(self._account)
        return await self._pages(
            OVERSEAS_PATH,
            _TR[OVERSEAS_PATH][self._kis.server],
            {
                "CANO": cano,
                "ACNT_PRDT_CD": product,
                "WCRC_FRCR_DVSN_CD": "02",  # 외화
                "NATN_CD": "000",
                "TR_MKET_CD": "00",
                "INQR_DVSN_CD": "00",
            },
            None,
        )

    async def test(self) -> None:
        _split_account(self._account)
        try:
            await self._domestic()
        except KisApiError as e:
            raise _account_error(e.message) from e

    async def holdings(self) -> list[HoldingRow]:
        rows = [
            HoldingRow(
                "KR",
                r["pdno"],
                r.get("prdt_name") or r["pdno"],
                _number(r["hldg_qty"]),
                _number(r["pchs_avg_pric"]),
                "KRW",
            )
            for r in await self._domestic()
        ]
        for r in await self._overseas():
            us = r.get("ovrs_excg_cd") in _US_EXCHANGES or r.get("natn_kor_name") == "미국"
            rows.append(
                HoldingRow(
                    "US" if us else None,
                    r["pdno"],
                    r.get("prdt_name") or r["pdno"],
                    _number(r["ccld_qty_smtl1"]),
                    _number(r["avg_unpr3"]),
                    r.get("buy_crcy_cd") or ("USD" if us else ""),
                )
            )
        return rows


ADAPTERS["kis"] = KisAdapter
