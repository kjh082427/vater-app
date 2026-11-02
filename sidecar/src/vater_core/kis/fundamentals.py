"""국내 종목 재무제표·재무비율·뉴스 제목 (검증 실험 S2: 국내 분석 공급자 `kis`의 데이터 원천).

Yahoo/SEC에는 국내 재무와 뉴스가 없어서,
TradingAgents의 펀더멘털·뉴스 애널리스트가 이 데이터를 쓴다.
금액 단위는 억원, 비율은 %. 한투는 값이 없을 때 `99.99`를 넣는다(금액 항목에서는 '-'로 표시).
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo

from vater_core.kis.client import KisClient
from vater_core.kis.config import Priority
from vater_core.kis.models import num

FinancialKind = Literal["balance_sheet", "income_statement", "financial_ratio"]
KST = ZoneInfo("Asia/Seoul")
PLACEHOLDER = "99.99"

_TR: dict[FinancialKind, tuple[str, str]] = {
    "balance_sheet": ("balance-sheet", "FHKST66430100"),
    "income_statement": ("income-statement", "FHKST66430200"),
    "financial_ratio": ("financial-ratio", "FHKST66430300"),
}

LABELS: dict[FinancialKind, dict[str, str]] = {
    "balance_sheet": {
        "cras": "유동자산", "fxas": "고정자산", "total_aset": "자산총계", "flow_lblt": "유동부채",
        "fix_lblt": "고정부채", "total_lblt": "부채총계", "cpfn": "자본금",
        "cfp_surp": "자본잉여금", "prfi_surp": "이익잉여금", "total_cptl": "자본총계",
    },
    "income_statement": {
        "sale_account": "매출액", "sale_cost": "매출원가", "sale_totl_prfi": "매출총이익",
        "depr_cost": "감가상각비", "sell_mang": "판매관리비", "bsop_prti": "영업이익",
        "bsop_non_ernn": "영업외수익", "bsop_non_expn": "영업외비용", "op_prfi": "경상이익",
        "spec_prfi": "특별이익", "spec_loss": "특별손실", "thtr_ntin": "당기순이익",
    },
    "financial_ratio": {
        "grs": "매출액증가율", "bsop_prfi_inrt": "영업이익증가율", "ntin_inrt": "순이익증가율",
        "roe_val": "ROE", "eps": "EPS(원)", "sps": "주당매출액(원)", "bps": "BPS(원)",
        "rsrv_rate": "유보율", "lblt_rate": "부채비율",
    },
}  # fmt: skip
_UNIT: dict[FinancialKind, str] = {
    "balance_sheet": "억원",
    "income_statement": "억원",
    "financial_ratio": "%",
}


@dataclass(frozen=True)
class NewsItem:
    at: datetime
    title: str
    source: str


async def financials(
    c: KisClient,
    code: str,
    kind: FinancialKind,
    period: Literal["year", "quarter"],
    priority: Priority = Priority.BRIEFING,
) -> list[dict[str, str]]:
    path, tr_id = _TR[kind]
    body = await c.get(
        f"/uapi/domestic-stock/v1/finance/{path}",
        tr_id,
        {
            "FID_DIV_CLS_CODE": "0" if period == "year" else "1",
            "fid_cond_mrkt_div_code": "J",
            "fid_input_iscd": code,
        },
        priority,
    )
    rows: list[dict[str, str]] = body.get("output", [])
    return rows


async def news_titles(
    c: KisClient, code: str | None = None, limit: int = 20, priority: Priority = Priority.BRIEFING
) -> list[NewsItem]:
    """종합 시황·공시 제목. `code`를 주면 해당 종목 관련 뉴스만."""
    blank = (
        "FID_NEWS_OFER_ENTP_CODE",
        "FID_COND_MRKT_CLS_CODE",
        "FID_TITL_CNTT",
        "FID_INPUT_DATE_1",
        "FID_INPUT_HOUR_1",
        "FID_RANK_SORT_CLS_CODE",
        "FID_INPUT_SRNO",
    )
    params = dict.fromkeys(blank, "") | {"FID_INPUT_ISCD": code or ""}
    body = await c.get(
        "/uapi/domestic-stock/v1/quotations/news-title", "FHKST01011800", params, priority
    )
    items = []
    for row in body.get("output", [])[:limit]:
        dt, tm = str(row.get("data_dt", "")), str(row.get("data_tm", "")).ljust(6, "0")
        if len(dt) != 8:
            continue
        at = datetime.strptime(dt + tm[:6], "%Y%m%d%H%M%S").replace(tzinfo=KST)
        items.append(NewsItem(at=at, title=str(row.get("hts_pbnt_titl_cntt", "")).strip(),
                              source=str(row.get("dorg", "")).strip()))  # fmt: skip
    return items


def _cell(kind: FinancialKind, raw: str | None) -> str:
    text = str(raw or "").strip()
    if not text or (kind != "financial_ratio" and text == PLACEHOLDER):
        return "-"
    value = num(text)
    if kind == "financial_ratio":
        return f"{value:,.2f}".rstrip("0").rstrip(".")
    return f"{value:,.0f}"


def as_markdown(kind: FinancialKind, rows: list[dict[str, str]], title: str, limit: int = 8) -> str:
    """TradingAgents 공급자 함수가 돌려줄 표 (최근 결산이 왼쪽)."""
    if not rows:
        return f"## {title}\n\n데이터 없음 (한국투자증권 응답이 비어 있음)"
    rows = rows[:limit]
    periods = [str(r.get("stac_yymm", "")) for r in rows]
    lines = [f"## {title}", "", f"단위: {_UNIT[kind]} · 결산년월 기준 · 출처: 한국투자증권", "",
             "| 항목 | " + " | ".join(periods) + " |", "|---|" + "---|" * len(periods)]  # fmt: skip
    for field, label in LABELS[kind].items():
        lines.append(f"| {label} | " + " | ".join(_cell(kind, r.get(field)) for r in rows) + " |")
    return "\n".join(lines)
