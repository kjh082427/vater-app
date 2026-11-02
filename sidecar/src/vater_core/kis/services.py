"""한투 연동 부품(토큰, 호출 제한, 클라이언트)을 현재 키·설정으로 조립한다.

키나 실전/모의 서버, 호출 한도 설정이 바뀌면 다음 호출에서 자동으로 다시 조립한다
(비교 키가 달라졌을 때만). 키가 없으면 None.
"""

from dataclasses import dataclass

import httpx

from vater_core.api.deps import AppDeps
from vater_core.api.errors import VaterError
from vater_core.kis.auth import TokenManager
from vater_core.kis.client import KisClient
from vater_core.kis.config import KisServer, load_credentials
from vater_core.kis.ratelimit import PriorityRateLimiter
from vater_core.store.settings import SettingsRepo

HTTP_TIMEOUT = 15.0


@dataclass
class KisServices:
    server: KisServer
    tokens: TokenManager
    client: KisClient
    fingerprint: tuple[str, ...]


def _http(deps: AppDeps) -> httpx.AsyncClient:
    if deps.http is None:
        deps.http = httpx.AsyncClient(timeout=HTTP_TIMEOUT)
    return deps.http


def get_kis(deps: AppDeps) -> KisServices | None:
    if deps.secrets is None or deps.db is None:
        return None
    try:
        creds = load_credentials(deps.secrets)
    except VaterError:
        deps.kis = None
        return None
    settings = SettingsRepo(deps.db)
    server = KisServer(settings.get("kis.server"))
    rate = int(settings.get(f"kis.rate_per_sec.{server.value}"))
    fingerprint = (creds.app_key, creds.app_secret, server.value, str(rate))
    current: KisServices | None = deps.kis
    if current is not None and current.fingerprint == fingerprint:
        return current
    http = _http(deps)
    tokens = TokenManager(http, deps.secrets, creds, server)
    services = KisServices(
        server=server,
        tokens=tokens,
        client=KisClient(http, tokens, creds, server, PriorityRateLimiter(rate)),
        fingerprint=fingerprint,
    )
    deps.kis = services
    return services


def require_kis(deps: AppDeps) -> KisServices:
    services = get_kis(deps)
    if services is None:
        raise VaterError(
            "KIS_NOT_CONFIGURED",
            "한국투자증권 앱키가 설정되지 않았습니다.",
            "설정 > 한국투자증권에서 앱키와 앱시크릿을 입력해 주세요.",
            status=409,
        )
    return services
