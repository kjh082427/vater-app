"""어댑터 규격과 등록 (v2 설계 1, 8장)."""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from vater_core.brokers.readonly import ReadOnlyHttp
from vater_core.secrets.store import SecretStore
from vater_core.store.holdings import HoldingRow


@dataclass(frozen=True)
class BrokerCreds:
    conn_id: int
    app_key: str
    app_secret: str
    account: str | None


@dataclass(frozen=True)
class BrokerContext:
    creds: BrokerCreds
    secrets: SecretStore  # 토큰 캐시(`BROKER_{id}_TOKEN`)
    make_http: Callable[[str, frozenset[tuple[str, str]]], ReadOnlyHttp]


class BrokerAdapter(Protocol):
    async def test(self) -> None:
        """키가 쓸 수 있는지 확인한다. 안 되면 `VaterError`."""

    async def holdings(self) -> list[HoldingRow]:
        """그 계좌의 보유 종목 전부. 오류면 예외, 보유가 없으면 빈 목록."""


AdapterFactory = Callable[[BrokerContext], BrokerAdapter]
# 증권사 id → 어댑터. 증권사별 브랜치가 여기에 더한다.
ADAPTERS: dict[str, AdapterFactory] = {}
