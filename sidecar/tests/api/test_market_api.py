"""`GET /market/indices` (대시보드 설계 4장)."""

import httpx


async def test_indices_without_kis_key_are_all_null(client: httpx.AsyncClient) -> None:
    r = await client.get("/market/indices")
    assert r.status_code == 200
    body = r.json()
    assert [x["code"] for x in body] == ["KOSPI", "KOSDAQ", "SPX", "COMP"]
    assert [x["name"] for x in body] == ["코스피", "코스닥", "S&P 500", "나스닥"]
    assert all(x["value"] is None and x["closes"] == [] for x in body)


async def test_indices_requires_token(anon_client: httpx.AsyncClient) -> None:
    assert (await anon_client.get("/market/indices")).status_code == 401
