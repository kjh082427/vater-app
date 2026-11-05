"""메리츠 실연동 확인. 기본 실행에서 제외된다: `uv run pytest -m broker_live -k meritz -q -s`

키는 저장소 루트 `.env`에서 읽기만 한다. 조회만 하고 개수만 출력한다. 토큰은 메모리에만 둔다.
"""

from pathlib import Path

import httpx
import pytest

from vater_core.brokers.base import BrokerContext, BrokerCreds
from vater_core.brokers.meritz import MeritzAdapter
from vater_core.brokers.readonly import ReadOnlyHttp
from vater_core.secrets.store import EnvFileSecretStore, SecretStore

pytestmark = pytest.mark.broker_live
ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"


async def test_holdings_counts_only(memory_tokens: SecretStore) -> None:
    env = EnvFileSecretStore(ROOT_ENV)
    key, secret = env.get("MERITZ_TEST_APP_KEY"), env.get("MERITZ_TEST_APP_SECRET")
    if not key or not secret:
        pytest.skip("MERITZ_TEST_APP_KEY/SECRET are not in the root .env")
    async with httpx.AsyncClient(timeout=15) as http:
        try:
            adapter = MeritzAdapter(
                BrokerContext(
                    BrokerCreds(0, key, secret, None),
                    memory_tokens,
                    lambda base, allowed: ReadOnlyHttp(http, base, allowed),
                )
            )
            await adapter.test()
            rows = await adapter.holdings()
        except Exception as e:  # 트레이스백에는 요청 값(키)이 나온다. 코드나 종류만 보여 준다
            pytest.fail(getattr(e, "code", type(e).__name__), pytrace=False)
    markets = {m: sum(1 for r in rows if r.market == m) for m in ("KR", "US", None)}
    print(f"\nholdings: {len(rows)} rows, by market {markets}")
    assert all(r.quantity >= 0 for r in rows)
