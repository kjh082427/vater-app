from typing import Any

import httpx


def seed(deps: Any) -> None:
    deps.db.executemany(
        "INSERT INTO symbols (market, code, exchange, name, name_en, kind) VALUES (?,?,?,?,?,?)",
        [
            ("KR", "005930", "KOSPI", "삼성전자", None, "stock"),
            ("KR", "069500", "KOSPI", "KODEX 200", None, "etf"),
            ("US", "AAPL", "NAS", "애플", "APPLE INC", "stock"),
        ],
    )
    deps.db.commit()


async def test_search_returns_ranked_symbols(client: httpx.AsyncClient, deps: Any) -> None:
    seed(deps)
    r = await client.get("/symbols/search", params={"q": "삼성"})
    assert r.status_code == 200
    assert r.json()[0] == {
        "market": "KR",
        "code": "005930",
        "exchange": "KOSPI",
        "name": "삼성전자",
        "name_en": None,
        "kind": "stock",
    }


async def test_search_by_english_name(client: httpx.AsyncClient, deps: Any) -> None:
    seed(deps)
    assert (await client.get("/symbols/search", params={"q": "apple"})).json()[0]["code"] == "AAPL"


async def test_empty_query_is_rejected(client: httpx.AsyncClient) -> None:
    r = await client.get("/symbols/search", params={"q": ""})
    assert r.status_code == 422 and r.json()["code"] == "REQUEST_INVALID"


async def test_search_requires_token(anon_client: httpx.AsyncClient) -> None:
    assert (await anon_client.get("/symbols/search", params={"q": "a"})).status_code == 401
