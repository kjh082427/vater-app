from collections.abc import AsyncIterator

import httpx
import pytest

from vater_core.kis.client import KisClient
from vater_core.kis.config import KisCredentials, KisServer
from vater_core.kis.ratelimit import PriorityRateLimiter


class StaticTokens:
    async def token(self) -> str:
        return "tok"

    async def invalidate(self, rejected: str | None = None) -> None:
        return None


@pytest.fixture
async def kis() -> AsyncIterator[KisClient]:
    creds = KisCredentials(app_key="ak", app_secret="as", hts_id=None)
    async with httpx.AsyncClient() as http:
        limiter = PriorityRateLimiter(1000)
        yield KisClient(http, StaticTokens(), creds, KisServer.PROD, limiter, retry_delays=(0,))
