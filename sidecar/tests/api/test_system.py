from pathlib import Path
from typing import Any

import httpx

from vater_core.api.app import create_app
from vater_core.api.deps import AppDeps


async def test_health_requires_token(anon_client: httpx.AsyncClient) -> None:
    r = await anon_client.get("/health")
    assert r.status_code == 401
    assert set(r.json()) == {"code", "message", "hint"} and r.json()["code"] == "AUTH_INVALID"


async def test_health_ok(client: httpx.AsyncClient) -> None:
    r = await client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


async def test_wrong_token_rejected(anon_client: httpx.AsyncClient) -> None:
    r = await anon_client.get("/health", headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401


async def test_shutdown_calls_hook(client: httpx.AsyncClient, deps: Any) -> None:
    called: list[bool] = []
    deps.shutdown = lambda: called.append(True)
    r = await client.post("/shutdown")
    assert r.status_code == 202 and called == [True]


async def test_cors_allows_tauri_origin(anon_client: httpx.AsyncClient) -> None:
    r = await anon_client.options(
        "/health",
        headers={"Origin": "http://tauri.localhost", "Access-Control-Request-Method": "GET"},
    )
    assert r.headers.get("access-control-allow-origin") == "http://tauri.localhost"


async def test_cors_blocks_other_origin(anon_client: httpx.AsyncClient) -> None:
    r = await anon_client.options(
        "/health",
        headers={"Origin": "http://evil.example", "Access-Control-Request-Method": "GET"},
    )
    assert "access-control-allow-origin" not in r.headers


async def test_vater_error_shape(client: httpx.AsyncClient, app_with_boom_route: Any) -> None:
    # 테스트 전용 라우트가 VaterError("X_TEST", "테스트", "힌트", 409)를 던진다
    r = await client.get("/__boom")
    assert r.status_code == 409
    assert r.json() == {"code": "X_TEST", "message": "테스트", "hint": "힌트"}


async def test_docs_hidden_in_production(anon_client: httpx.AsyncClient) -> None:
    """설치된 앱에서 Swagger UI와 명세를 토큰 없이 열 수 없어야 한다 (리뷰 Important #3)."""
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert (await anon_client.get(path)).status_code == 404, path


async def test_docs_available_in_dev_mode(tmp_path: Path) -> None:
    app = create_app(AppDeps(token="t", dev=True, data_dir=tmp_path))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        assert (await c.get("/openapi.json")).status_code == 200


async def test_unknown_route_uses_error_shape(client: httpx.AsyncClient) -> None:
    r = await client.get("/nope")
    assert r.status_code == 404 and set(r.json()) == {"code", "message", "hint"}
