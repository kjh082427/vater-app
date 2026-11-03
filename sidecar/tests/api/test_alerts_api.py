"""감시 종목·알림 API. 감시 루프는 만들기만 하고 돌리지 않는다."""

import httpx
import pytest

from vater_core.alerts.store import EventRepo, RuleRepo
from vater_core.api.deps import AppDeps

SYMBOLS = [
    ("KR", "005930", "KOSPI", "삼성전자", None, "stock"),
    ("US", "AAPL", "NAS", "애플", "APPLE INC", "stock"),
]


@pytest.fixture(autouse=True)
def symbols(deps: AppDeps) -> None:
    assert deps.db is not None
    deps.db.executemany(
        "INSERT INTO symbols (market, code, exchange, name, name_en, kind) VALUES (?,?,?,?,?,?)",
        SYMBOLS,
    )
    deps.db.commit()


async def add(client: httpx.AsyncClient, market: str = "KR", code: str = "005930") -> int:
    r = await client.post("/watchlist", json={"market": market, "code": code})
    assert r.status_code == 201, r.text
    wid: int = r.json()["id"]
    return wid


async def test_watchlist_add_list_delete(client: httpx.AsyncClient) -> None:
    r = await client.post("/watchlist", json={"market": "US", "code": "aapl"})
    assert r.status_code == 201
    body = r.json()
    assert (body["market"], body["code"], body["exchange"], body["name"]) == (
        "US",
        "AAPL",
        "NAS",
        "애플",
    )
    await add(client)
    assert [w["code"] for w in (await client.get("/watchlist")).json()] == ["AAPL", "005930"]

    assert (await client.delete(f"/watchlist/{body['id']}")).status_code == 204
    assert [w["code"] for w in (await client.get("/watchlist")).json()] == ["005930"]


async def test_watchlist_errors(client: httpx.AsyncClient) -> None:
    await add(client)
    dup = await client.post("/watchlist", json={"market": "KR", "code": "005930"})
    assert (dup.status_code, dup.json()["code"]) == (409, "WATCHLIST_DUPLICATE")
    unknown = await client.post("/watchlist", json={"market": "KR", "code": "999999"})
    assert (unknown.status_code, unknown.json()["code"]) == (404, "SYMBOL_UNKNOWN")
    missing = await client.delete("/watchlist/999")
    assert (missing.status_code, missing.json()["code"]) == (404, "WATCHLIST_NOT_FOUND")


async def test_create_rule_fills_defaults(client: httpx.AsyncClient) -> None:
    wid = await add(client)
    r = await client.post("/alerts/rules", json={"watchlist_id": wid, "kind": "rsi"})
    assert r.status_code == 201
    rule = r.json()
    assert rule["params"] == {"period": 14, "upper": 70.0, "lower": 30.0, "direction": "overbought"}
    assert (rule["timing"], rule["enabled"], rule["last_state"]) == ("close", True, None)

    r = await client.post(
        "/alerts/rules",
        json={"watchlist_id": wid, "kind": "rsi", "timing": "realtime", "enabled": False},
    )
    assert (r.json()["timing"], r.json()["enabled"]) == ("realtime", False)
    listed = (await client.get("/alerts/rules", params={"watchlist_id": wid})).json()
    assert len(listed) == 2


@pytest.mark.parametrize(
    "payload",
    [
        {"kind": "price_above", "params": {}},  # 필수 price 없음
        {"kind": "ma_cross", "params": {"fast": 20, "slow": 5}},
        {"kind": "rsi", "params": {"period": 14, "colour": "red"}},
        {"kind": "moon_phase"},
    ],
)
async def test_create_rule_rejects_bad_input(
    client: httpx.AsyncClient, payload: dict[str, object]
) -> None:
    wid = await add(client)
    r = await client.post("/alerts/rules", json={"watchlist_id": wid, **payload})
    assert (r.status_code, r.json()["code"]) == (422, "ALERT_RULE_INVALID")


async def test_create_rule_needs_a_watched_symbol(client: httpx.AsyncClient) -> None:
    r = await client.post("/alerts/rules", json={"watchlist_id": 42, "kind": "rsi"})
    assert (r.status_code, r.json()["code"]) == (404, "WATCHLIST_NOT_FOUND")


async def test_patch_and_delete_rule(client: httpx.AsyncClient, deps: AppDeps) -> None:
    assert deps.db is not None
    wid = await add(client)
    rid = (
        await client.post(
            "/alerts/rules",
            json={"watchlist_id": wid, "kind": "price_above", "params": {"price": 1}},
        )
    ).json()["id"]
    RuleRepo(deps.db).set_state(rid, True)

    r = await client.patch(f"/alerts/rules/{rid}", json={"params": {"price": 2}})
    assert (r.json()["params"], r.json()["last_state"]) == ({"price": 2.0}, None)
    bad = await client.patch(f"/alerts/rules/{rid}", json={"params": {"price": -1}})
    assert (bad.status_code, bad.json()["code"]) == (422, "ALERT_RULE_INVALID")
    off = await client.patch(f"/alerts/rules/{rid}", json={"enabled": False})
    assert off.json()["enabled"] is False

    assert (await client.delete(f"/alerts/rules/{rid}")).status_code == 204
    gone = await client.patch(f"/alerts/rules/{rid}", json={"enabled": True})
    assert (gone.status_code, gone.json()["code"]) == (404, "ALERT_RULE_NOT_FOUND")
    assert (await client.delete(f"/alerts/rules/{rid}")).status_code == 404


async def test_deleting_a_symbol_deletes_its_rules(client: httpx.AsyncClient) -> None:
    wid = await add(client)
    await client.post("/alerts/rules", json={"watchlist_id": wid, "kind": "rsi"})
    await client.delete(f"/watchlist/{wid}")
    assert (await client.get("/alerts/rules")).json() == []


async def test_events_newest_first_with_limit(client: httpx.AsyncClient, deps: AppDeps) -> None:
    assert deps.db is not None
    wid = await add(client)
    rid = (await client.post("/alerts/rules", json={"watchlist_id": wid, "kind": "rsi"})).json()[
        "id"
    ]
    events = EventRepo(deps.db)
    events.add(rid, "2026-11-03T10:00:00+09:00", 72.3, "삼성전자 RSI(14) 72.3 — 과매수 진입")
    events.add(None, "2026-11-03T11:00:00+09:00", None, "AI 분석 완료: 삼성전자 — 매수")

    body = (await client.get("/alerts/events", params={"limit": 1})).json()
    assert body == [
        {
            "id": 2,
            "rule_id": None,
            "fired_at": "2026-11-03T11:00:00+09:00",
            "value": None,
            "message": "AI 분석 완료: 삼성전자 — 매수",
            "market": None,
            "code": None,
            "name": None,
            "kind": None,
        }
    ]
    older = (await client.get("/alerts/events")).json()[1]
    assert (older["rule_id"], older["code"], older["kind"]) == (rid, "005930", "rsi")


async def test_pause_resume_and_status(client: httpx.AsyncClient) -> None:
    assert (await client.post("/alerts/pause")).json() == {"state": "paused"}
    status = (await client.get("/alerts/status")).json()
    assert (status["state"], status["realtime"], status["polling"]) == ("paused", 0, 0)
    assert (await client.post("/alerts/resume")).json()["state"] != "paused"


async def test_kinds_describe_the_rule_form(client: httpx.AsyncClient) -> None:
    kinds = {k["kind"]: k for k in (await client.get("/alerts/kinds")).json()}
    assert len(kinds) == 10
    assert kinds["price_above"] == {
        "kind": "price_above",
        "params": {},
        "required": ["price"],
        "timing": "realtime",
    }
    assert kinds["macd_cross"]["params"] == {
        "fast": 12,
        "slow": 26,
        "signal": 9,
        "direction": "golden",
    }
    assert kinds["macd_cross"]["timing"] == "close"


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/watchlist"),
        ("POST", "/watchlist"),
        ("DELETE", "/watchlist/1"),
        ("GET", "/alerts/rules"),
        ("POST", "/alerts/rules"),
        ("PATCH", "/alerts/rules/1"),
        ("DELETE", "/alerts/rules/1"),
        ("GET", "/alerts/events"),
        ("POST", "/alerts/pause"),
        ("POST", "/alerts/resume"),
        ("GET", "/alerts/status"),
        ("GET", "/alerts/kinds"),
        ("GET", "/watchlist/quotes"),
    ],
)
async def test_routes_need_the_token(
    anon_client: httpx.AsyncClient, method: str, path: str
) -> None:
    r = await anon_client.request(method, path)
    assert r.status_code == 401


async def test_watch_quotes_route_lists_every_watched_symbol(client: httpx.AsyncClient) -> None:
    wid = await add(client)
    # 한투 키가 없는 상태: 실패하지 않고 가격만 비어 있다
    rows = (await client.get("/watchlist/quotes")).json()
    assert rows == [
        {
            "watchlist_id": wid,
            "market": "KR",
            "code": "005930",
            "name": "삼성전자",
            "price": None,
            "change": None,
            "change_pct": None,
            "at": None,
            "source": None,
            "feed": "idle",
        }
    ]


async def test_status_includes_markets_and_feeds(client: httpx.AsyncClient) -> None:
    body = (await client.get("/alerts/status")).json()
    assert set(body) == {"state", "realtime", "polling", "markets", "feeds"}
    assert body["feeds"] == [] and isinstance(body["markets"], dict)
