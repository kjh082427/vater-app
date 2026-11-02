"""시장 전체 데이터 (일일 브리핑용, 스펙 6장): 지수, 업종, 순위, 투자자 수급, 해외 지수.

모든 호출의 우선순위는 BRIEFING이다(알림 감시보다 뒤).
"""

from dataclasses import dataclass
from datetime import date
from typing import Literal

from vater_core.kis.client import KisClient
from vater_core.kis.config import Priority
from vater_core.kis.models import Bar, num, signed_change, ymd

DomesticMarket = Literal["KOSPI", "KOSDAQ"]
OverseasIndexCode = Literal["SPX", "COMP", ".DJI"]  # S&P500, 나스닥 종합, 다우존스

_INDEX_CODE: dict[DomesticMarket, str] = {"KOSPI": "0001", "KOSDAQ": "1001"}
_MARKET_CLS: dict[DomesticMarket, str] = {"KOSPI": "K", "KOSDAQ": "Q"}
_INVESTOR_MARKET: dict[DomesticMarket, str] = {"KOSPI": "KSP", "KOSDAQ": "KSQ"}
Q = "/uapi/domestic-stock/v1/quotations"


@dataclass(frozen=True)
class IndexQuote:
    code: str
    name: str
    value: float
    change: float
    change_pct: float


@dataclass(frozen=True)
class SectorBoard:
    index: IndexQuote
    advancers: int
    decliners: int
    unchanged: int
    sectors: list[IndexQuote]


@dataclass(frozen=True)
class RankItem:
    rank: int
    code: str
    name: str
    price: float
    change_pct: float
    trading_value: int  # 원


@dataclass(frozen=True)
class InvestorFlows:
    """시장별 순매수 금액 (단위: 백만원). 양수는 순매수, 음수는 순매도."""

    day: date
    foreign: int
    institution: int
    individual: int


@dataclass(frozen=True)
class OverseasIndex:
    quote: IndexQuote
    bars: list[Bar]


def _index(code: str, name: str, o: dict[str, str]) -> IndexQuote:
    return IndexQuote(
        code=code,
        name=name,
        value=num(o["bstp_nmix_prpr"]),
        change=signed_change(o["bstp_nmix_prdy_vrss"], o.get("prdy_vrss_sign")),
        change_pct=num(o["bstp_nmix_prdy_ctrt"]),
    )


async def index_quote(c: KisClient, market: DomesticMarket) -> IndexQuote:
    code = _INDEX_CODE[market]
    body = await c.get(
        f"{Q}/inquire-index-price",
        "FHPUP02100000",
        {"FID_COND_MRKT_DIV_CODE": "U", "FID_INPUT_ISCD": code},
        Priority.BRIEFING,
    )
    return _index(code, market, body["output"])


async def sector_board(c: KisClient, market: DomesticMarket) -> SectorBoard:
    code = _INDEX_CODE[market]
    params = {
        "FID_COND_MRKT_DIV_CODE": "U",
        "FID_INPUT_ISCD": code,
        "FID_COND_SCR_DIV_CODE": "20214",
        "FID_MRKT_CLS_CODE": _MARKET_CLS[market],
        "FID_BLNG_CLS_CODE": "0",  # 전업종
    }
    body = await c.get(
        f"{Q}/inquire-index-category-price", "FHPUP02140000", params, Priority.BRIEFING
    )
    o1 = body["output1"]
    sectors = [
        _index(str(r["bstp_cls_code"]), str(r["hts_kor_isnm"]), r) for r in body.get("output2", [])
    ]
    return SectorBoard(
        index=_index(code, market, o1),
        advancers=int(num(o1.get("ascn_issu_cnt"))),
        decliners=int(num(o1.get("down_issu_cnt"))),
        unchanged=int(num(o1.get("stnr_issu_cnt"))),
        sectors=sectors,
    )


def _rank(r: dict[str, str]) -> RankItem:
    return RankItem(
        rank=int(num(r.get("data_rank"))),
        code=str(r.get("stck_shrn_iscd") or r.get("mksc_shrn_iscd") or ""),
        name=str(r.get("hts_kor_isnm", "")),
        price=num(r.get("stck_prpr")),
        change_pct=num(r.get("prdy_ctrt")),
        trading_value=int(num(r.get("acml_tr_pbmn"))),
    )


async def fluctuation_rank(
    c: KisClient, direction: Literal["up", "down"], limit: int = 10
) -> list[RankItem]:
    """등락률 순위(코스피+코스닥 전체).

    정렬 코드는 한 자리여야 한다. 공식 예제의 '0000'은 INVALID INPUT_FILED_SIZE로 거부된다.
    """
    params = {
        "fid_rsfl_rate2": "",
        "fid_cond_mrkt_div_code": "J",
        "fid_cond_scr_div_code": "20170",
        "fid_input_iscd": "0000",
        "fid_rank_sort_cls_code": "0" if direction == "up" else "1",
        "fid_input_cnt_1": "0",
        "fid_prc_cls_code": "0",
        "fid_input_price_1": "",
        "fid_input_price_2": "",
        "fid_vol_cnt": "",
        "fid_trgt_cls_code": "0",
        "fid_trgt_exls_cls_code": "0",
        "fid_div_cls_code": "0",
        "fid_rsfl_rate1": "",
    }
    body = await c.get(
        "/uapi/domestic-stock/v1/ranking/fluctuation", "FHPST01700000", params, Priority.BRIEFING
    )
    return [_rank(r) for r in body.get("output", [])[:limit]]


async def trading_value_rank(c: KisClient, limit: int = 10) -> list[RankItem]:
    """거래대금 상위 (FID_BLNG_CLS_CODE=3: 거래금액순)."""
    params = {
        "FID_COND_MRKT_DIV_CODE": "J",
        "FID_COND_SCR_DIV_CODE": "20171",
        "FID_INPUT_ISCD": "0000",
        "FID_DIV_CLS_CODE": "0",
        "FID_BLNG_CLS_CODE": "3",
        "FID_TRGT_CLS_CODE": "111111111",
        "FID_TRGT_EXLS_CLS_CODE": "0000000000",
        "FID_INPUT_PRICE_1": "",
        "FID_INPUT_PRICE_2": "",
        "FID_VOL_CNT": "",
        "FID_INPUT_DATE_1": "",
    }
    body = await c.get(f"{Q}/volume-rank", "FHPST01710000", params, Priority.BRIEFING)
    return [_rank(r) for r in body.get("output", [])[:limit]]


async def investor_flows(c: KisClient, market: DomesticMarket, day: date) -> InvestorFlows:
    d = day.strftime("%Y%m%d")
    code = _INDEX_CODE[market]
    params = {
        "FID_COND_MRKT_DIV_CODE": "U",
        "FID_INPUT_ISCD": code,
        "FID_INPUT_DATE_1": d,
        "FID_INPUT_ISCD_1": _INVESTOR_MARKET[market],
        "FID_INPUT_DATE_2": d,
        "FID_INPUT_ISCD_2": code,
    }
    body = await c.get(
        f"{Q}/inquire-investor-daily-by-market", "FHPTJ04040000", params, Priority.BRIEFING
    )
    rows = body.get("output", [])
    row = next((r for r in rows if r.get("stck_bsop_date") == d), rows[0] if rows else {})
    return InvestorFlows(
        day=ymd(str(row.get("stck_bsop_date") or d)),
        foreign=int(num(row.get("frgn_ntby_tr_pbmn"))),
        institution=int(num(row.get("orgn_ntby_tr_pbmn"))),
        individual=int(num(row.get("prsn_ntby_tr_pbmn"))),
    )


async def overseas_index(
    c: KisClient, code: OverseasIndexCode, start: date, end: date
) -> OverseasIndex:
    params = {
        "FID_COND_MRKT_DIV_CODE": "N",
        "FID_INPUT_ISCD": code,
        "FID_INPUT_DATE_1": start.strftime("%Y%m%d"),
        "FID_INPUT_DATE_2": end.strftime("%Y%m%d"),
        "FID_PERIOD_DIV_CODE": "D",
    }
    body = await c.get(
        "/uapi/overseas-price/v1/quotations/inquire-daily-chartprice",
        "FHKST03030100",
        params,
        Priority.BRIEFING,
    )
    o1 = body["output1"]
    quote = IndexQuote(
        code=code,
        name=str(o1.get("hts_kor_isnm") or code),
        value=num(o1["ovrs_nmix_prpr"]),
        change=signed_change(o1["ovrs_nmix_prdy_vrss"], o1.get("prdy_vrss_sign")),
        change_pct=num(o1["prdy_ctrt"]),
    )
    bars = sorted(
        (
            Bar(
                day=ymd(r["stck_bsop_date"]),
                open=num(r["ovrs_nmix_oprc"]),
                high=num(r["ovrs_nmix_hgpr"]),
                low=num(r["ovrs_nmix_lwpr"]),
                close=num(r["ovrs_nmix_prpr"]),
                volume=int(num(r.get("acml_vol"))),
            )
            for r in body.get("output2", [])
            if r.get("stck_bsop_date")
        ),
        key=lambda b: b.day,
    )
    return OverseasIndex(quote=quote, bars=bars)
