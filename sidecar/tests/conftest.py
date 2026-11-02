from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI

from vater_core.api.app import create_app
from vater_core.api.deps import AppDeps
from vater_core.api.errors import VaterError

TEST_TOKEN = "test-token"


@pytest.fixture
def deps(tmp_path: Path) -> AppDeps:
    return AppDeps(token=TEST_TOKEN, dev=False, data_dir=tmp_path / "data")


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
def app_with_boom_route(app: FastAPI) -> FastAPI:
    @app.get("/__boom")
    async def boom() -> None:
        raise VaterError("X_TEST", "테스트", "힌트", 409)

    return app
