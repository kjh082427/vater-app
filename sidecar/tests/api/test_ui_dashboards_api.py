"""`GET/PUT /ui/dashboards` (대시보드 설계 4장)."""

import json
from typing import Any

import httpx


def board(i: int = 0, panels: int = 4) -> dict[str, Any]:
    return {
        "id": f"d{i}",
        "name": f"화면 {i}",
        "kpi": {"enabled": False, "items": []},
        "layout": {"template": "grid-2x2", "root": {"dir": "row", "sizes": [0.5, 0.5]}},
        "panels": [{"type": "recent-alerts", "options": {}} for _ in range(panels)],
    }


def doc(*boards: dict[str, Any]) -> dict[str, Any]:
    return {"version": 1, "dashboards": list(boards) or [board()]}


async def test_get_empty_then_put_and_get(client: httpx.AsyncClient) -> None:
    r = await client.get("/ui/dashboards")
    assert r.status_code == 200 and r.json() == {"version": 1, "dashboards": []}
    d = doc(board(0), board(1, panels=3))
    r = await client.put("/ui/dashboards", json=d)
    assert r.status_code == 200 and r.json() == d
    assert (await client.get("/ui/dashboards")).json() == d


async def test_put_invalid_is_422_with_hint_and_keeps_previous(client: httpx.AsyncClient) -> None:
    good = doc()
    await client.put("/ui/dashboards", json=good)
    r = await client.put("/ui/dashboards", json={"version": 1, "dashboards": []})
    body = r.json()
    assert r.status_code == 422 and body["code"] == "DASHBOARD_INVALID" and body["hint"]
    assert (await client.get("/ui/dashboards")).json() == good


async def test_put_over_64kb_is_422(client: httpx.AsyncClient) -> None:
    d: dict[str, Any] = doc()
    d["dashboards"][0]["panels"][0]["options"] = {"note": "x" * 70_000}
    r = await client.put("/ui/dashboards", json=d)
    assert r.status_code == 422 and r.json()["code"] == "DASHBOARD_INVALID"


async def test_put_not_json_or_array_is_422(client: httpx.AsyncClient) -> None:
    r = await client.put(
        "/ui/dashboards", content=b"{not json", headers={"Content-Type": "application/json"}
    )
    assert r.status_code == 422 and r.json()["code"] == "DASHBOARD_INVALID"
    r = await client.put("/ui/dashboards", content=json.dumps([doc()]).encode())
    assert r.status_code == 422 and r.json()["code"] == "DASHBOARD_INVALID"


async def test_requires_token(anon_client: httpx.AsyncClient) -> None:
    assert (await anon_client.get("/ui/dashboards")).status_code == 401


async def test_dashboards_not_in_settings(client: httpx.AsyncClient) -> None:
    await client.put("/ui/dashboards", json=doc())
    assert "ui.dashboards" not in (await client.get("/settings")).json()


def _nested(depth: int) -> dict[str, Any]:
    node: dict[str, Any] = {}
    for _ in range(depth):
        node = {"n": node}
    return node


async def test_deeply_nested_root_is_422_and_previous_kept(client: httpx.AsyncClient) -> None:
    good = doc()
    await client.put("/ui/dashboards", json=good)
    bad = doc()
    bad["dashboards"][0]["layout"]["root"] = _nested(300)
    r = await client.put("/ui/dashboards", json=bad)
    assert r.status_code == 422 and r.json()["code"] == "DASHBOARD_INVALID"
    g = await client.get("/ui/dashboards")
    assert g.status_code == 200 and g.json() == good


async def test_recursion_bomb_body_is_422(client: httpx.AsyncClient) -> None:
    body = ("[" * 10000 + "]" * 10000).encode()
    r = await client.put(
        "/ui/dashboards", content=body, headers={"Content-Type": "application/json"}
    )
    assert r.status_code == 422 and r.json()["code"] == "DASHBOARD_INVALID"
