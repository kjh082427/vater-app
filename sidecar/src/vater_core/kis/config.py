"""서버 구분, 호스트, 자격 증명, 호출 우선순위."""

from dataclasses import dataclass
from enum import IntEnum, StrEnum

from vater_core.api.errors import VaterError
from vater_core.secrets.names import SecretName
from vater_core.secrets.store import SecretStore


class KisServer(StrEnum):
    PROD = "prod"  # 실전
    VPS = "vps"  # 모의투자


REST_HOST: dict[KisServer, str] = {
    KisServer.PROD: "https://openapi.koreainvestment.com:9443",
    KisServer.VPS: "https://openapivts.koreainvestment.com:29443",
}
WS_HOST: dict[KisServer, str] = {
    KisServer.PROD: "ws://ops.koreainvestment.com:21000",
    KisServer.VPS: "ws://ops.koreainvestment.com:31000",
}


class Priority(IntEnum):
    """호출 우선순위. 작을수록 먼저 (스펙 7-2: 알림 감시 > 브리핑 수집 > 종목 마스터)."""

    ALERTS = 0
    BRIEFING = 1
    MASTER = 2


@dataclass(frozen=True)
class KisCredentials:
    app_key: str
    app_secret: str
    hts_id: str | None

    def __repr__(self) -> str:  # 실수로 로그에 찍혀도 값이 나가지 않게
        return "KisCredentials(app_key=***, app_secret=***)"


def load_credentials(secrets: SecretStore) -> KisCredentials:
    key = secrets.get(SecretName.KIS_APP_KEY)
    secret = secrets.get(SecretName.KIS_APP_SECRET)
    if not key or not secret:
        raise VaterError(
            "KIS_NOT_CONFIGURED",
            "한국투자증권 앱키가 설정되지 않았습니다.",
            "설정 > 한국투자증권에서 앱키와 앱시크릿을 입력해 주세요.",
            status=409,
        )
    return KisCredentials(app_key=key, app_secret=secret, hts_id=secrets.get(SecretName.KIS_HTS_ID))
