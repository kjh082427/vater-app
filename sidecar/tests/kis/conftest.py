import json
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Any

import httpx
import pytest

from vater_core.kis.client import KisClient
from vater_core.kis.config import KisCredentials, KisServer
from vater_core.kis.ratelimit import PriorityRateLimiter

FIXTURES = Path(__file__).parent / "fixtures"


def load_fixture(name: str) -> dict[str, Any]:
    """실연동 탐색(2026-11-03)에서 받은 실제 응답. 목록은 앞 3개만 남겼다."""
    data: dict[str, Any] = json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))
    return data


@pytest.fixture
def fixture() -> Callable[[str], dict[str, Any]]:
    return load_fixture


class StaticTokens:
    async def token(self) -> str:
        return "tok"

    async def invalidate(self, rejected: str | None = None) -> None:
        return None


@pytest.fixture
async def kis() -> AsyncIterator[KisClient]:
    creds = KisCredentials(app_key="ak", app_secret="as", hts_id=None)
    async with httpx.AsyncClient() as http:
        yield KisClient(http, StaticTokens(), creds, KisServer.PROD, PriorityRateLimiter(1000),
                        retry_delays=(0, 0, 0))  # fmt: skip
