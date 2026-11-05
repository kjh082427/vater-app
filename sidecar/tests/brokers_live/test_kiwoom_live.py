"""키움 실연동 확인. 기본 실행에서 제외된다: `uv run pytest -m broker_live -k kiwoom -q -s`

키는 저장소 루트 `.env`에서 읽기만 한다. 조회만 하고 개수만 출력한다. 토큰은 메모리에만 둔다.
"""

from pathlib import Path

import httpx
import pytest

from vater_core.api.errors import VaterError
from vater_core.brokers.base import BrokerContext, BrokerCreds
from vater_core.brokers.kiwoom import KiwoomAdapter
from vater_core.brokers.readonly import ReadOnlyHttp
from vater_core.secrets.store import EnvFileSecretStore

pytestmark = pytest.mark.broker_live
ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"


class MemoryTokens:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}

    def get(self, name: str) -> str | None:
        return self.values.get(name)

    def set(self, name: str, value: str) -> None:
        self.values[name] = value

    def delete(self, name: str) -> None:
        self.values.pop(name, None)

    def known_values(self) -> list[str]:
        return list(self.values.values())


async def test_holdings_counts_only() -> None:
    env = EnvFileSecretStore(ROOT_ENV)
    key, secret = env.get("KIWOOM_TEST_APP_KEY"), env.get("KIWOOM_TEST_APP_SECRET")
    if not key or not secret:
        pytest.skip("KIWOOM_TEST_APP_KEY/SECRET are not in the root .env")
    async with httpx.AsyncClient(timeout=15) as http:
        adapter = KiwoomAdapter(
            BrokerContext(
                BrokerCreds(0, key, secret, None),
                MemoryTokens(),
                lambda base, allowed: ReadOnlyHttp(http, base, allowed),
            )
        )
        try:
            await adapter.test()
            rows = await adapter.holdings()
        except VaterError as e:  # 트레이스백에는 요청 값(키)이 나온다. 코드만 보여 준다
            pytest.fail(e.code, pytrace=False)
    markets = {m: sum(1 for r in rows if r.market == m) for m in ("KR", "US", None)}
    print(f"\nholdings: {len(rows)} rows, by market {markets}")
    assert all(r.quantity >= 0 for r in rows)
