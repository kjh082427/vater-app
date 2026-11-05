"""증권사 연결과 보유 내역 API (v2 설계 1, 2, 4-1장). 어댑터는 가짜다."""

from collections.abc import Iterator
from decimal import Decimal
from typing import Any

import httpx
import pytest

from vater_core.api.deps import AppDeps
from vater_core.api.errors import VaterError
from vater_core.brokers import base
from vater_core.brokers.base import BrokerContext
from vater_core.secrets.names import SecretName, broker_secret
from vater_core.store.db import open_db
from vater_core.store.holdings import HoldingRow, HoldingsRepo

KRW = "KRW"


def sam(qty: str, avg: str | None = "60000") -> HoldingRow:
    return HoldingRow("KR", "005930", "삼성전자", Decimal(qty), Decimal(avg) if avg else None, KRW)


class Fake:
    def __init__(self) -> None:
        self.rows: list[HoldingRow] = []
        self.test_error: VaterError | None = None
        self.sync_error: VaterError | None = None
        self.contexts: list[BrokerContext] = []

    def __call__(self, ctx: BrokerContext) -> "Fake":
        self.contexts.append(ctx)
        return self

    async def test(self) -> None:
        if self.test_error:
            raise self.test_error

    async def holdings(self) -> list[HoldingRow]:
        if self.sync_error:
            raise self.sync_error
        return list(self.rows)


@pytest.fixture
def fakes() -> Iterator[dict[str, Fake]]:
    made = {"kiwoom": Fake(), "meritz": Fake(), "kis": Fake()}
    saved = dict(base.ADAPTERS)
    base.ADAPTERS.update(made)
    yield made
    base.ADAPTERS.clear()
    base.ADAPTERS.update(saved)


async def connect(c: httpx.AsyncClient, broker: str = "kiwoom", account: str = "81234567") -> Any:
    r = await c.post(
        "/connections",
        json={"broker_id": broker, "app_key": "key-a", "app_secret": "sec-b", "account": account},
    )
    assert r.status_code == 201, r.text
    return r.json()


AUTH = VaterError("BROKER_AUTH_INVALID", "키를 확인하세요.", "다시 발급받아 주세요.", 401)
DOWN = VaterError("BROKER_UNREACHABLE", "연결할 수 없습니다.", status=503)


async def test_brokers_list_and_add(client: httpx.AsyncClient) -> None:
    got = (await client.get("/brokers")).json()
    assert [b["id"] for b in got] == ["kis", "meritz", "kiwoom", "samsung", "mirae"]
    r = await client.post("/brokers", json={"name": "신한"})
    assert r.status_code == 201 and r.json()["kind"] == "manual"
    assert (await client.post("/brokers", json={"name": "신한"})).status_code == 422


async def test_connect_saves_secrets_and_masks_account(
    client: httpx.AsyncClient, deps: AppDeps, fakes: dict[str, Fake]
) -> None:
    c = await connect(client)
    assert c["account_mask"] == "****4567" and c["status"] == "ok"
    assert deps.secrets is not None
    assert deps.secrets.get(broker_secret(c["id"], "APP_SECRET")) == "sec-b"
    text = (await client.get("/connections")).text
    assert "81234567" not in text and "sec-b" not in text and "key-a" not in text


async def test_failed_test_leaves_no_connection_or_secret(
    client: httpx.AsyncClient, deps: AppDeps, fakes: dict[str, Fake]
) -> None:
    fakes["kiwoom"].test_error = AUTH
    r = await client.post(
        "/connections",
        json={"broker_id": "kiwoom", "app_key": "k", "app_secret": "bad-secret"},
    )
    assert r.status_code == 401 and r.json()["hint"] == "다시 발급받아 주세요."
    assert (await client.get("/connections")).json() == []
    assert deps.secrets is not None
    assert "bad-secret" not in deps.secrets.known_values()


async def test_manual_or_unknown_broker_cannot_connect(
    client: httpx.AsyncClient, fakes: dict[str, Fake]
) -> None:
    for broker in ("samsung", "nope"):
        r = await client.post(
            "/connections", json={"broker_id": broker, "app_key": "k", "app_secret": "s"}
        )
        assert r.status_code == 422 and r.json()["code"] == "BROKER_UNKNOWN"


async def test_kis_connection_uses_the_saved_app_key(
    client: httpx.AsyncClient, deps: AppDeps, fakes: dict[str, Fake]
) -> None:
    assert deps.secrets is not None
    deps.secrets.set(SecretName.KIS_APP_KEY, "kis-key")
    deps.secrets.set(SecretName.KIS_APP_SECRET, "kis-sec")
    r = await client.post("/connections", json={"broker_id": "kis", "account": "12345678-01"})
    assert r.status_code == 201, r.text
    creds = fakes["kis"].contexts[-1].creds
    assert (creds.app_key, creds.app_secret, creds.account) == ("kis-key", "kis-sec", "12345678-01")
    assert deps.secrets.get(broker_secret(r.json()["id"], "APP_KEY")) is None


async def test_duplicate_account_is_refused(
    client: httpx.AsyncClient, fakes: dict[str, Fake]
) -> None:
    await connect(client)
    r = await client.post(
        "/connections",
        json={"broker_id": "kiwoom", "app_key": "k", "app_secret": "s", "account": "81234567"},
    )
    assert r.status_code == 409 and r.json()["code"] == "BROKER_DUPLICATE"


async def test_sync_one_broker_failing_keeps_its_data_and_updates_others(
    client: httpx.AsyncClient, fakes: dict[str, Fake]
) -> None:
    a = await connect(client, "kiwoom")
    b = await connect(client, "meritz")
    fakes["kiwoom"].rows = [sam("10")]
    fakes["meritz"].rows = [sam("5", "72000")]
    await client.post("/holdings/sync", json={})
    fakes["kiwoom"].sync_error = DOWN
    fakes["meritz"].rows = [sam("6", "72000")]
    r = await client.post("/holdings/sync", json={})
    results = {x["connection_id"]: x for x in r.json()}
    assert results[a["id"]]["ok"] is False and results[a["id"]]["error"]["code"] == (
        "BROKER_UNREACHABLE"
    )
    assert results[b["id"]]["ok"] is True
    got = (await client.get("/holdings/symbol/KR/005930")).json()
    assert {x["broker_id"]: x["quantity"] for x in got["brokers"]} == {
        "kiwoom": "10",
        "meritz": "6",
    }


async def test_sync_can_target_one_broker(
    client: httpx.AsyncClient, fakes: dict[str, Fake]
) -> None:
    a = await connect(client, "kiwoom")
    await connect(client, "meritz")
    r = await client.post("/holdings/sync", json={"broker_id": "kiwoom"})
    assert [x["connection_id"] for x in r.json()] == [a["id"]]


async def test_auth_failure_marks_connection_lost_but_keeps_data(
    client: httpx.AsyncClient, fakes: dict[str, Fake]
) -> None:
    await connect(client)
    fakes["kiwoom"].rows = [sam("10")]
    await client.post("/holdings/sync", json={})
    fakes["kiwoom"].sync_error = AUTH
    await client.post("/holdings/sync", json={})
    conn = (await client.get("/connections")).json()[0]
    assert (conn["status"], conn["last_error"]) == ("lost", "BROKER_AUTH_INVALID")
    got = (await client.get("/holdings/symbol/KR/005930")).json()
    assert got["total"] == "10" and got["brokers"][0]["stale"] is True


async def test_empty_success_means_everything_was_sold(
    client: httpx.AsyncClient, fakes: dict[str, Fake]
) -> None:
    await connect(client)
    fakes["kiwoom"].rows = [sam("10")]
    await client.post("/holdings/sync", json={})
    fakes["kiwoom"].rows = []
    await client.post("/holdings/sync", json={})
    got = (await client.get("/holdings/symbol/KR/005930")).json()
    assert got["total"] == "0" and got["brokers"] == [] and got["avg_price"] is None


async def test_symbol_summary_combines_average_and_ratio(
    client: httpx.AsyncClient, fakes: dict[str, Fake]
) -> None:
    await connect(client, "kiwoom")
    await connect(client, "meritz")
    fakes["kiwoom"].rows = [sam("10", "60000")]
    fakes["meritz"].rows = [sam("5", "72000")]
    await client.post("/holdings/sync", json={})
    got = (await client.get("/holdings/symbol/KR/005930")).json()
    assert got["total"] == "15" and got["avg_price"] == 64000 and got["cost"] == 960000
    assert got["unpriced_quantity"] == "0" and got["currency"] == "KRW"
    ratios = {b["broker_id"]: b["ratio"] for b in got["brokers"]}
    assert ratios["kiwoom"] == pytest.approx(66.6667, abs=0.001)
    assert ratios["meritz"] == pytest.approx(33.3333, abs=0.001)
    assert got["brokers"][0]["color"].startswith("#")


async def test_summary_skips_quantity_without_average(
    client: httpx.AsyncClient, fakes: dict[str, Fake]
) -> None:
    await connect(client, "kiwoom")
    await connect(client, "meritz")
    fakes["kiwoom"].rows = [sam("10", "60000")]
    fakes["meritz"].rows = [sam("5", None)]
    await client.post("/holdings/sync", json={})
    got = (await client.get("/holdings/symbol/KR/005930")).json()
    assert got["avg_price"] == 60000 and got["cost"] == 600000
    assert got["total"] == "15" and got["unpriced_quantity"] == "5"


async def test_two_accounts_of_a_broker_merge_into_one_entry(
    client: httpx.AsyncClient, fakes: dict[str, Fake]
) -> None:
    await connect(client, "kiwoom", "11110000")
    await connect(client, "kiwoom", "22220000")
    fakes["kiwoom"].rows = [sam("2", "100")]
    await client.post("/holdings/sync", json={})
    got = (await client.get("/holdings/symbol/KR/005930")).json()
    assert [(b["broker_id"], b["quantity"], b["ratio"]) for b in got["brokers"]] == [
        ("kiwoom", "4", 100.0)
    ]


async def test_unsupported_market_is_listed_but_cannot_be_watched(
    client: httpx.AsyncClient, fakes: dict[str, Fake]
) -> None:
    await connect(client)
    fakes["kiwoom"].rows = [HoldingRow(None, "7203", "토요타", Decimal("1"), None, "JPY")]
    await client.post("/holdings/sync", json={})
    rows = (await client.get("/holdings")).json()
    assert rows[0]["supported"] is False and rows[0]["market"] is None


def _seed_symbol(deps: AppDeps, code: str = "005930", name: str = "삼성전자") -> None:
    assert deps.db is not None
    deps.db.execute(
        "INSERT INTO symbols (market, code, exchange, name, name_en, kind) VALUES (?,?,?,?,?,?)",
        ("KR", code, "KOSPI", name, None, "stock"),
    )
    deps.db.commit()


async def test_watch_adds_checked_items_and_skips_existing(
    client: httpx.AsyncClient, deps: AppDeps
) -> None:
    _seed_symbol(deps)
    _seed_symbol(deps, "000660", "SK하이닉스")
    items = [{"market": "KR", "code": "005930"}, {"market": "KR", "code": "000660"}]
    assert (await client.post("/watchlist", json=items[0])).status_code == 201
    r = await client.post("/holdings/watch", json={"items": items})
    assert r.status_code == 200 and r.json() == {"added": 1, "skipped": 1, "rules": 0}
    assert len((await client.get("/watchlist")).json()) == 2
    assert (await client.get("/alerts/rules")).json() == []


async def test_watch_can_apply_one_rule_in_bulk(client: httpx.AsyncClient, deps: AppDeps) -> None:
    _seed_symbol(deps)
    r = await client.post(
        "/holdings/watch",
        json={
            "items": [{"market": "KR", "code": "005930"}],
            "rule": {"kind": "rsi", "params": {"period": 14, "upper": 70, "lower": 30}},
        },
    )
    assert r.json()["rules"] == 1
    assert [x["kind"] for x in (await client.get("/alerts/rules")).json()] == ["rsi"]


@pytest.mark.parametrize("kind", ["price_above", "price_below"])
async def test_bulk_rule_refuses_target_prices(
    client: httpx.AsyncClient, deps: AppDeps, kind: str
) -> None:
    _seed_symbol(deps)
    r = await client.post(
        "/holdings/watch",
        json={"items": [{"market": "KR", "code": "005930"}], "rule": {"kind": kind, "params": {}}},
    )
    assert r.status_code == 422
    assert (await client.get("/watchlist")).json() == []


async def test_watch_unknown_symbol_is_reported_not_fatal(
    client: httpx.AsyncClient, deps: AppDeps
) -> None:
    _seed_symbol(deps)
    r = await client.post(
        "/holdings/watch",
        json={
            "items": [{"market": "KR", "code": "005930"}, {"market": "KR", "code": "999999"}],
        },
    )
    assert r.json() == {"added": 1, "skipped": 1, "rules": 0}


async def test_requires_token(anon_client: httpx.AsyncClient) -> None:
    for path in ("/brokers", "/connections", "/holdings"):
        assert (await anon_client.get(path)).status_code == 401


def test_repo_import_is_usable(tmp_path: Any) -> None:
    assert HoldingsRepo(open_db(tmp_path)).connections() == []


class _Clock:
    t = 0.0

    def __call__(self) -> float:
        return self.t


async def test_periodic_sync_only_when_enabled_and_market_open(
    deps: AppDeps, fakes: dict[str, Fake]
) -> None:
    from vater_core.holdings.service import HoldingsService
    from vater_core.store.settings import SettingsRepo

    assert deps.db is not None
    calls: list[str | None] = []
    is_open = {"v": True}
    clock = _Clock()
    service = HoldingsService(deps, is_market_open=lambda: is_open["v"], monotonic=clock)

    async def fake_sync(broker_id: str | None = None) -> list[Any]:
        calls.append(broker_id)
        return []

    service.sync = fake_sync  # type: ignore[method-assign]
    await service.tick_once()
    assert calls == []  # 기본은 끔
    SettingsRepo(deps.db).update({"holdings.sync_minutes": 10})
    await service.tick_once()
    assert len(calls) == 1
    clock.t = 300
    await service.tick_once()
    assert len(calls) == 1  # 아직 10분이 안 됐다
    clock.t = 601
    is_open["v"] = False
    await service.tick_once()
    assert len(calls) == 1  # 장이 닫혔다
    is_open["v"] = True
    await service.tick_once()
    assert len(calls) == 2


async def test_sync_minutes_setting_only_takes_listed_values(client: httpx.AsyncClient) -> None:
    assert (await client.get("/settings")).json()["holdings.sync_minutes"] == 0
    ok = await client.patch("/settings", json={"holdings.sync_minutes": 30})
    assert ok.status_code == 200
    bad = await client.patch("/settings", json={"holdings.sync_minutes": 5})
    assert bad.status_code == 422 and bad.json()["code"] == "SETTING_INVALID"


# ---- 연결 해제 (v2 설계 1-1장) ------------------------------------------------


async def test_disconnect_and_delete_removes_holdings_and_secrets_but_keeps_watchlist(
    client: httpx.AsyncClient, deps: AppDeps, fakes: dict[str, Fake]
) -> None:
    _seed_symbol(deps)
    c = await connect(client)
    fakes["kiwoom"].rows = [sam("10")]
    await client.post("/holdings/sync", json={})
    await client.post("/holdings/watch", json={"items": [{"market": "KR", "code": "005930"}]})
    r = await client.delete(f"/connections/{c['id']}", params={"delete_data": "true"})
    assert r.status_code == 204
    assert deps.secrets is not None
    assert deps.secrets.get(broker_secret(c["id"], "APP_KEY")) is None
    assert (await client.get("/connections")).json() == []
    assert (await client.get("/holdings")).json() == []
    assert len((await client.get("/watchlist")).json()) == 1


async def test_disconnect_and_keep_shows_stale_and_counts_in_total(
    client: httpx.AsyncClient, deps: AppDeps, fakes: dict[str, Fake]
) -> None:
    c = await connect(client)
    fakes["kiwoom"].rows = [sam("10")]
    await client.post("/holdings/sync", json={})
    await client.delete(f"/connections/{c['id']}", params={"delete_data": "false"})
    assert deps.secrets is not None
    assert deps.secrets.get(broker_secret(c["id"], "APP_SECRET")) is None
    assert (await client.get("/connections")).json()[0]["status"] == "disconnected"
    got = (await client.get("/holdings/symbol/KR/005930")).json()
    assert got["total"] == "10" and got["brokers"][0]["stale"] is True
    fakes["kiwoom"].sync_error = AUTH
    assert (await client.post("/holdings/sync", json={})).json() == []  # 다시 부르지 않는다


async def test_deleting_a_disconnected_connection_later(
    client: httpx.AsyncClient, fakes: dict[str, Fake]
) -> None:
    c = await connect(client)
    fakes["kiwoom"].rows = [sam("10")]
    await client.post("/holdings/sync", json={})
    await client.delete(f"/connections/{c['id']}", params={"delete_data": "false"})
    assert (
        await client.delete(f"/connections/{c['id']}", params={"delete_data": "true"})
    ).status_code == 204
    assert (await client.get("/holdings")).json() == []


async def test_disconnect_unknown_is_404(client: httpx.AsyncClient) -> None:
    r = await client.delete("/connections/99", params={"delete_data": "true"})
    assert r.status_code == 404 and r.json()["code"] == "CONNECTION_NOT_FOUND"


async def test_reconnect_after_disconnect_is_not_a_duplicate(
    client: httpx.AsyncClient, fakes: dict[str, Fake]
) -> None:
    c = await connect(client)
    await client.delete(f"/connections/{c['id']}", params={"delete_data": "false"})
    await connect(client)  # 비밀키를 지웠으므로 같은 계좌로 다시 연결할 수 있다


# ---- 수동 입력 (v2 설계 5장) ---------------------------------------------------


MANUAL = {
    "broker_id": "samsung",
    "market": "KR",
    "code": "005930",
    "quantity": "5",
    "avg_price": 72000,
}


async def test_manual_add_update_delete(client: httpx.AsyncClient, deps: AppDeps) -> None:
    _seed_symbol(deps)
    r = await client.put("/holdings/manual", json=MANUAL)
    assert r.status_code == 200
    got = (await client.get("/holdings")).json()[0]
    assert (got["name"], got["quantity"], got["avg_price"], got["currency"], got["source"]) == (
        "삼성전자",
        "5",
        72000,
        "KRW",
        "manual",
    )
    await client.put("/holdings/manual", json={**MANUAL, "quantity": "7.5"})
    assert (await client.get("/holdings")).json()[0]["quantity"] == "7.5"
    r = await client.request(
        "DELETE",
        "/holdings/manual",
        json={"broker_id": "samsung", "market": "KR", "code": "005930"},
    )
    assert r.status_code == 204 and (await client.get("/holdings")).json() == []


@pytest.mark.parametrize(
    "change",
    [
        {"quantity": "0"},
        {"quantity": "-1"},
        {"quantity": "abc"},
        {"quantity": ""},
        {"avg_price": 0},
        {"avg_price": -5},
        {"avg_price": None},
        {"broker_id": "nope"},
        {"code": "999999"},
    ],
)
async def test_manual_requires_valid_values(
    client: httpx.AsyncClient, deps: AppDeps, change: dict[str, Any]
) -> None:
    _seed_symbol(deps)
    r = await client.put("/holdings/manual", json={**MANUAL, **change})
    assert r.status_code in (404, 422), r.text
    assert (await client.get("/holdings")).json() == []


async def test_manual_refused_for_a_connected_broker(
    client: httpx.AsyncClient, deps: AppDeps, fakes: dict[str, Fake]
) -> None:
    _seed_symbol(deps)
    await connect(client, "kiwoom")
    r = await client.put("/holdings/manual", json={**MANUAL, "broker_id": "kiwoom"})
    assert r.status_code == 422 and r.json()["code"] == "HOLDING_INVALID"


async def test_sync_does_not_overwrite_manual_rows(
    client: httpx.AsyncClient, deps: AppDeps, fakes: dict[str, Fake]
) -> None:
    _seed_symbol(deps)
    await client.put("/holdings/manual", json=MANUAL)
    await connect(client, "kiwoom")
    fakes["kiwoom"].rows = []
    await client.post("/holdings/sync", json={})
    assert [h["broker_id"] for h in (await client.get("/holdings")).json()] == ["samsung"]


async def test_delete_broker_data_for_a_manual_broker(
    client: httpx.AsyncClient, deps: AppDeps
) -> None:
    _seed_symbol(deps)
    await client.put("/holdings/manual", json={**MANUAL, "broker_id": "mirae"})
    await client.put("/holdings/manual", json=MANUAL)
    assert (await client.delete("/brokers/mirae/data")).status_code == 204
    assert [h["broker_id"] for h in (await client.get("/holdings")).json()] == ["samsung"]


async def test_reconnecting_the_same_account_replaces_kept_rows(
    client: httpx.AsyncClient, fakes: dict[str, Fake]
) -> None:
    c = await connect(client)
    fakes["kiwoom"].rows = [sam("10")]
    await client.post("/holdings/sync", json={})
    await client.delete(f"/connections/{c['id']}", params={"delete_data": "false"})
    await connect(client)  # 같은 계좌
    await client.post("/holdings/sync", json={})
    assert (await client.get("/holdings/symbol/KR/005930")).json()["total"] == "10"
