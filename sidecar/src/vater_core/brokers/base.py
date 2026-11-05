"""어댑터 규격과 등록 (v2 설계 1, 8장)."""

from collections.abc import Callable
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any, Protocol

from vater_core.brokers.readonly import ReadOnlyHttp
from vater_core.kis.config import KisServer, Priority
from vater_core.secrets.store import SecretStore
from vater_core.store.holdings import HoldingRow, bad_broker_response


def number(raw: Any) -> Decimal:
    """증권사 응답의 수량. 읽지 못하면 저장하지 않도록 실패한다."""
    try:
        return Decimal(str(raw))
    except InvalidOperation:
        raise bad_broker_response() from None


def stock_code(raw: Any) -> str:
    """증권사 응답의 종목코드. 비어 있으면 저장하지 않도록 실패한다."""
    code = str(raw or "").strip()
    if not code:
        raise bad_broker_response()
    return code


def average(raw: Any) -> Decimal | None:
    """증권사 응답의 평단가. 비어 있으면 모르는 값이다."""
    return number(raw) if raw not in (None, "") else None


@dataclass(frozen=True)
class BrokerCreds:
    conn_id: int
    app_key: str = field(repr=False)
    app_secret: str = field(repr=False)
    account: str | None = field(repr=False)


class KisReader(Protocol):
    """한투 어댑터가 보는 `KisClient`의 전부. GET뿐이라 주문이 나갈 수 없다."""

    server: KisServer

    async def get_page(
        self, path: str, tr_id: str, params: dict[str, str], priority: Priority, tr_cont: str
    ) -> tuple[dict[str, Any], str]: ...


@dataclass(frozen=True)
class BrokerContext:
    creds: BrokerCreds
    secrets: SecretStore  # 토큰 캐시(`BROKER_{id}_TOKEN`)
    make_http: Callable[[str, frozenset[tuple[str, str]]], ReadOnlyHttp]
    kis: KisReader | None = None  # 한투 연결에만 있다


class BrokerAdapter(Protocol):
    async def test(self) -> None:
        """키가 쓸 수 있는지 확인한다. 안 되면 `VaterError`."""

    async def holdings(self) -> list[HoldingRow]:
        """그 계좌의 보유 종목 전부. 오류면 예외, 보유가 없으면 빈 목록."""


AdapterFactory = Callable[[BrokerContext], BrokerAdapter]
# 증권사 id → 어댑터. 증권사별 브랜치가 여기에 더한다.
ADAPTERS: dict[str, AdapterFactory] = {}
