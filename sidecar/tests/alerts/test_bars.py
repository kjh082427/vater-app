import json
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx

from vater_core.alerts.bars import HISTORY_DAYS, refresh_bars
from vater_core.alerts.store import BarRepo, WatchItem
from vater_core.kis.client import KisClient
from vater_core.kis.config import REST_HOST, KisServer
from vater_core.store.db import open_db

HOST = REST_HOST[KisServer.PROD]
DOMESTIC = f"{HOST}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice"
OVERSEAS = f"{HOST}/uapi/overseas-price/v1/quotations/dailyprice"
FIX = Path(__file__).parents[1] / "kis" / "fixtures"
SAMSUNG = WatchItem(1, "KR", "005930", "KOSPI", "삼성전자", "")
APPLE = WatchItem(2, "US", "AAPL", "NAS", "애플", "")


def fixture(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((FIX / f"{name}.json").read_text(encoding="utf-8"))
    return data


@pytest.fixture
def repo(tmp_path: Path) -> BarRepo:
    return BarRepo(open_db(tmp_path))


def us_page(end: date, n: int = 100) -> dict[str, Any]:
    """`end`부터 거꾸로 평일 `n`개 (한투 해외 일봉 응답 형식)."""
    rows: list[dict[str, str]] = []
    d = end
    while len(rows) < n:
        if d.weekday() < 5:
            rows.append(
                {"xymd": d.strftime("%Y%m%d"), "open": "10", "high": "11", "low": "9",
                 "clos": "10.5", "tvol": "1000"}
            )  # fmt: skip
        d -= timedelta(days=1)
    return {"rt_cd": "0", "msg_cd": "", "msg1": "", "output1": {}, "output2": rows}


@respx.mock
async def test_domestic_refresh_and_skip_when_current(kis: KisClient, repo: BarRepo) -> None:
    route = respx.get(DOMESTIC).respond(json=fixture("domestic_daily"))
    today = date(2026, 11, 2)
    assert await refresh_bars(kis, repo, SAMSUNG, today) == 3
    params = route.calls[0].request.url.params
    assert params["FID_INPUT_ISCD"] == "005930"
    assert params["FID_INPUT_DATE_1"] == (today - timedelta(days=HISTORY_DAYS)).strftime("%Y%m%d")
    assert repo.last_day("KR", "005930") == today
    assert await refresh_bars(kis, repo, SAMSUNG, today) == 0  # 이미 최신이면 부르지 않는다
    assert route.call_count == 1


@respx.mock
async def test_domestic_incremental_refresh(kis: KisClient, repo: BarRepo) -> None:
    route = respx.get(DOMESTIC).respond(json=fixture("domestic_daily"))
    await refresh_bars(kis, repo, SAMSUNG, date(2026, 11, 2))
    await refresh_bars(kis, repo, SAMSUNG, date(2026, 11, 3))
    start = route.calls[1].request.url.params["FID_INPUT_DATE_1"]
    # 이미 있는 마지막 날의 며칠 전부터만 다시 받는다 (수정주가 반영)
    assert start == (date(2026, 11, 2) - timedelta(days=7)).strftime("%Y%m%d")


@respx.mock
async def test_overseas_refresh_pages_back(kis: KisClient, repo: BarRepo) -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        end = date.fromisoformat(
            f"{request.url.params['BYMD'][:4]}-{request.url.params['BYMD'][4:6]}-"
            f"{request.url.params['BYMD'][6:]}"
        )
        return httpx.Response(200, json=us_page(end))

    route = respx.get(OVERSEAS).mock(side_effect=respond)
    today = date(2026, 11, 2)
    saved = await refresh_bars(kis, repo, APPLE, today)
    assert saved >= 260  # 52주 계산에 충분
    assert route.call_count == 3
    assert route.calls[0].request.url.params["EXCD"] == "NAS"
    h = repo.history("US", "AAPL")
    assert h.days[-1] == today and len(h.days) == 260


def test_history_days_covers_a_year() -> None:
    assert HISTORY_DAYS >= 380
