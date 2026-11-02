from collections.abc import Callable
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import pytest
import respx

from vater_core.kis.client import KisClient
from vater_core.kis.config import REST_HOST, KisServer
from vater_core.kis.fundamentals import as_markdown, financials, news_titles

HOST = REST_HOST[KisServer.PROD]
Fx = Callable[[str], dict[str, Any]]


@pytest.mark.parametrize(
    ("kind", "path", "tr_id"),
    [("balance_sheet", "balance-sheet", "FHKST66430100"),
     ("income_statement", "income-statement", "FHKST66430200"),
     ("financial_ratio", "financial-ratio", "FHKST66430300")],
)  # fmt: skip
@respx.mock
async def test_financials_calls_right_tr(
    kis: KisClient, fixture: Fx, kind: Any, path: str, tr_id: str
) -> None:
    route = respx.get(f"{HOST}/uapi/domestic-stock/v1/finance/{path}").mock(
        return_value=httpx.Response(200, json=fixture(kind))
    )
    rows = await financials(kis, "005930", kind, "quarter")
    assert rows and "stac_yymm" in rows[0]
    req = route.calls[0].request
    assert req.headers["tr_id"] == tr_id
    assert dict(req.url.params) == {"FID_DIV_CLS_CODE": "1", "fid_cond_mrkt_div_code": "J",
                                    "fid_input_iscd": "005930"}  # fmt: skip


@respx.mock
async def test_news_titles(kis: KisClient, fixture: Fx) -> None:
    route = respx.get(f"{HOST}/uapi/domestic-stock/v1/quotations/news-title").mock(
        return_value=httpx.Response(200, json=fixture("news_title"))
    )
    items = await news_titles(kis, "005930", limit=2)
    assert len(items) == 2
    assert items[0].at == datetime(2026, 11, 2, 22, 0, 4, tzinfo=ZoneInfo("Asia/Seoul"))
    assert items[0].title.startswith('"반도체 끝났나"') and items[0].source == "한국경제신문"
    assert route.calls[0].request.url.params["FID_INPUT_ISCD"] == "005930"


def test_markdown_income_statement_hides_placeholder(fixture: Fx) -> None:
    rows = fixture("income_statement")["output"]
    md = as_markdown("income_statement", rows, "삼성전자 손익계산서")
    assert md.startswith("## 삼성전자 손익계산서")
    assert "단위: 억원" in md and "매출액" in md and "당기순이익" in md
    assert "99.99" not in md  # 값 없음 표시는 '-'로
    assert "3,053,729" in md


def test_markdown_ratio_keeps_values(fixture: Fx) -> None:
    md = as_markdown("financial_ratio", fixture("financial_ratio")["output"], "재무비율")
    assert "ROE" in md and "31.39" in md and "부채비율" in md and "단위: %" in md


def test_markdown_empty() -> None:
    assert "데이터 없음" in as_markdown("balance_sheet", [], "대차대조표")
