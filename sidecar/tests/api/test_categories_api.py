from pathlib import Path
from typing import Any

import httpx
import pytest

from vater_core.api.routes import categories as routes
from vater_core.categories import service

RAW = {
    "version": 1,
    "source": "test",
    "groups": [
        {
            "id": "it",
            "name": "IT",
            "mids": [
                {
                    "id": "semi",
                    "name": "반도체",
                    "keywords": ["반도체 소켓"],
                    "kr": ["005930", "058470", "999999"],  # 999999는 상장 폐지
                    "us": ["NVDA"],
                },
                {
                    "id": "sw",
                    "name": "소프트웨어",
                    "keywords": [],
                    "kr": ["005930"],
                    "us": ["MSFT"],
                },
            ],
        },
        {
            "id": "fin",
            "name": "금융",
            "mids": [
                {"id": "bank", "name": "은행", "keywords": [], "kr": ["105560"], "us": ["JPM"]},
                {
                    "id": "empty",
                    "name": "빈 분류",
                    "keywords": ["희귀"],
                    "kr": ["888888"],
                    "us": [],
                },
            ],
        },
    ],
}
SYMBOLS = [
    ("KR", "005930", "KOSPI", "삼성전자", None, "stock"),
    ("KR", "058470", "KOSDAQ", "리노공업", None, "stock"),
    ("KR", "105560", "KOSPI", "KB금융", None, "stock"),
    ("KR", "000001", "KOSPI", "신규상장", None, "stock"),  # 분류표에 없다
    ("KR", "069500", "KOSPI", "KODEX 200", None, "etf"),
    ("US", "NVDA", "NAS", "엔비디아", "NVIDIA CORP", "stock"),
    ("US", "MSFT", "NAS", "마이크로소프트", "MICROSOFT CORP", "stock"),
    ("US", "JPM", "NYS", "JP모건", "JPMORGAN CHASE", "stock"),
    ("US", "005930", "NYS", "코드만 같은 미국 종목", None, "stock"),
]


@pytest.fixture(autouse=True)
def fake_catalog(monkeypatch: pytest.MonkeyPatch, deps: Any) -> None:
    cat = service.Catalog(RAW)
    monkeypatch.setattr(service, "load_catalog", lambda: cat)
    deps.db.executemany(
        "INSERT INTO symbols (market, code, exchange, name, name_en, kind) VALUES (?,?,?,?,?,?)",
        SYMBOLS,
    )
    deps.db.commit()


async def stocks(client: httpx.AsyncClient, node: str, market: str | None = None) -> list[Any]:
    params = {"node": node, **({"market": market} if market else {})}
    r = await client.get("/categories/stocks", params=params)
    assert r.status_code == 200, r.text
    return list(r.json())


def keys(rows: list[Any]) -> set[tuple[str, str]]:
    return {(r["market"], r["code"]) for r in rows}


async def test_tree_has_groups_mids_and_unclassified_last(client: httpx.AsyncClient) -> None:
    tree = (await client.get("/categories")).json()
    assert [g["id"] for g in tree] == ["it", "fin", "unclassified"]
    assert [m["id"] for m in tree[0]["mids"]] == ["semi", "sw"]
    assert tree[2]["name"] == "미분류" and tree[2]["mids"] == []


async def test_group_is_union_of_mids_without_duplicates(client: httpx.AsyncClient) -> None:
    rows = await stocks(client, "it")
    assert len(rows) == len(keys(rows)) == 4  # 삼성전자는 두 분류에 있어도 한 번
    samsung = next(r for r in rows if r["code"] == "005930" and r["market"] == "KR")
    assert samsung["mids"] == ["semi", "sw"] and samsung["name"] == "삼성전자"
    assert await stocks(client, "semi") != await stocks(client, "sw")


async def test_market_filter_and_same_code_in_two_markets(client: httpx.AsyncClient) -> None:
    assert keys(await stocks(client, "semi", "KR")) == {("KR", "005930"), ("KR", "058470")}
    assert keys(await stocks(client, "semi", "US")) == {("US", "NVDA")}
    assert keys(await stocks(client, "semi")) == keys(await stocks(client, "semi", "ALL"))
    assert ("US", "005930") not in keys(await stocks(client, "it", "ALL"))


async def test_delisted_and_etf_are_left_out_and_empty_is_ok(client: httpx.AsyncClient) -> None:
    assert ("KR", "999999") not in keys(await stocks(client, "semi"))
    assert await stocks(client, "empty") == []
    assert [r["code"] for r in await stocks(client, "bank", "KR")] == ["105560"]


async def test_unclassified_lists_listed_stocks_missing_from_catalog(
    client: httpx.AsyncClient,
) -> None:
    rows = await stocks(client, "unclassified")
    assert keys(rows) == {("KR", "000001"), ("US", "005930")}  # 같은 코드라도 시장이 다르면 별개
    assert all(r["mids"] == [] for r in rows)
    assert keys(await stocks(client, "unclassified", "KR")) == {("KR", "000001")}


async def test_unknown_node_and_bad_market(client: httpx.AsyncClient) -> None:
    r = await client.get("/categories/stocks", params={"node": "nope"})
    assert r.status_code == 404 and r.json()["code"] == "CATEGORY_NOT_FOUND"
    r = await client.get("/categories/stocks", params={"node": "it", "market": "JP"})
    assert r.status_code == 422


async def test_search_matches_category_name_and_theme_keyword(client: httpx.AsyncClient) -> None:
    by_name = (await client.get("/categories/search", params={"q": "반도체"})).json()
    assert [(n["id"], n["match"]) for n in by_name["nodes"]] == [("semi", "name")]
    by_kw = (await client.get("/categories/search", params={"q": "소켓"})).json()
    hit = by_kw["nodes"][0]
    assert (hit["id"], hit["match"], hit["keyword"], hit["level"]) == (
        "semi",
        "keyword",
        "반도체 소켓",
        "mid",
    )
    assert hit["parent"] == "IT" and hit["count"] == 3
    group = (await client.get("/categories/search", params={"q": "금융"})).json()["nodes"]
    assert [(n["id"], n["level"]) for n in group] == [("fin", "group")]


async def test_search_market_filter_hides_nodes_without_stocks_there(
    client: httpx.AsyncClient,
) -> None:
    kr = (await client.get("/categories/search", params={"q": "은행", "market": "KR"})).json()
    assert [n["count"] for n in kr["nodes"]] == [1]
    none = (await client.get("/categories/search", params={"q": "희귀", "market": "KR"})).json()
    assert none["nodes"] == []  # 상장된 종목이 없는 분류는 뺀다


async def test_search_finds_unclassified_stock_by_name_and_empty_result(
    client: httpx.AsyncClient,
) -> None:
    r = (await client.get("/categories/search", params={"q": "신규상장"})).json()
    assert r["nodes"] == [] and [s["code"] for s in r["stocks"]] == ["000001"]
    assert r["stocks"][0]["mids"] == []
    us = (await client.get("/categories/search", params={"q": "신규상장", "market": "US"})).json()
    assert us == {"nodes": [], "stocks": []}
    nothing = (await client.get("/categories/search", params={"q": "없는말"})).json()
    assert nothing == {"nodes": [], "stocks": []}


async def test_search_stock_shows_all_its_categories(client: httpx.AsyncClient) -> None:
    r = (await client.get("/categories/search", params={"q": "삼성전자"})).json()
    assert r["stocks"][0]["mids"] == ["semi", "sw"]


async def test_empty_query_and_missing_token(
    client: httpx.AsyncClient, anon_client: httpx.AsyncClient
) -> None:
    assert (await client.get("/categories/search", params={"q": ""})).status_code == 422
    assert (await anon_client.get("/categories")).status_code == 401


def test_categories_code_does_not_touch_personal_data() -> None:
    for path in (Path(service.__file__), Path(routes.__file__)):
        text = path.read_text(encoding="utf-8")
        assert "holdings" not in text and "watchlist" not in text, path.name


async def test_blank_search_matches_nothing(client: httpx.AsyncClient) -> None:
    got = (await client.get("/categories/search", params={"q": "   "})).json()
    assert got["nodes"] == [] and got["stocks"] == []
