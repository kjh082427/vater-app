import asyncio
import socket
import threading
import time
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import httpx
import pytest
import uvicorn
from fastapi import FastAPI

from vater_core.api.app import create_app
from vater_core.api.deps import AppDeps
from vater_core.api.errors import VaterError
from vater_core.api.events import EventBus
from vater_core.secrets.store import EnvFileSecretStore
from vater_core.store.db import open_db

TEST_TOKEN = "test-token"


@pytest.fixture
def deps(tmp_path: Path) -> AppDeps:
    data_dir = tmp_path / "data"
    return AppDeps(
        token=TEST_TOKEN,
        dev=False,
        data_dir=data_dir,
        db=open_db(data_dir),
        secrets=EnvFileSecretStore(tmp_path / "secrets.env"),
        events=EventBus(),
    )


@pytest.fixture
def app(deps: AppDeps) -> FastAPI:
    return create_app(deps)


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {TEST_TOKEN}"}
    async with httpx.AsyncClient(transport=transport, base_url="http://test", headers=headers) as c:
        yield c


@pytest.fixture
async def anon_client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
def live_server(app: FastAPI, deps: AppDeps) -> Iterator[tuple[str, AppDeps]]:
    """끝나지 않는 SSE 스트림은 ASGITransport로 시험할 수 없어서 실제 서버를 띄운다."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    sock.listen(128)
    port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, log_config=None, access_log=False))
    thread = threading.Thread(target=lambda: asyncio.run(server.serve(sockets=[sock])), daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not server.started:
        if time.monotonic() > deadline:
            raise RuntimeError("live server did not start")
        time.sleep(0.02)
    yield f"http://127.0.0.1:{port}", deps
    server.should_exit = True
    thread.join(timeout=10)


@pytest.fixture
def app_with_boom_route(app: FastAPI) -> FastAPI:
    @app.get("/__boom")
    async def boom() -> None:
        raise VaterError("X_TEST", "테스트", "힌트", 409)

    return app
