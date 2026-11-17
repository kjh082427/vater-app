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
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1"
    ) as c:
        assert (await c.get("/openapi.json")).status_code == 200


async def test_unknown_route_uses_error_shape(client: httpx.AsyncClient) -> None:
    r = await client.get("/nope")
    assert r.status_code == 404 and set(r.json()) == {"code", "message", "hint"}


async def test_foreign_host_header_rejected(client: httpx.AsyncClient) -> None:
    # DNS 리바인딩: 악성 사이트 이름이 127.0.0.1을 가리켜도 Host가 다르면 거절한다
    r = await client.get("/health", headers={"Host": "evil.example"})
    assert r.status_code == 400 and r.json()["code"] == "HOST_INVALID"


async def test_loopback_hosts_allowed(client: httpx.AsyncClient) -> None:
    for host in ("127.0.0.1", "127.0.0.1:51234", "localhost:8000"):
        r = await client.get("/health", headers={"Host": host})
        assert r.status_code == 200, host


async def test_oversized_body_rejected_before_reading(client: httpx.AsyncClient) -> None:
    from vater_core.api.app import MAX_BODY_BYTES

    big = b"A" * (MAX_BODY_BYTES + 1)
    r = await client.put(
        "/ui/dashboards", content=big, headers={"content-type": "application/json"}
    )
    assert r.status_code == 413 and r.json()["code"] == "BODY_TOO_LARGE"

    async def chunks():  # Content-Length 없이 흘려보내도 상한에서 끊는다
        for _ in range(MAX_BODY_BYTES // 65536 + 2):
            yield b"A" * 65536

    r = await client.put("/ui/dashboards", content=chunks())
    assert r.status_code == 413 and r.json()["code"] == "BODY_TOO_LARGE"
