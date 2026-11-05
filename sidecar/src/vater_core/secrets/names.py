"""비밀키 이름. 개발용 `.env`의 키 이름과 같다 (`.env.example` 참고)."""

from enum import StrEnum
from typing import Literal


class SecretName(StrEnum):
    KIS_APP_KEY = "KIS_APP_KEY"
    KIS_APP_SECRET = "KIS_APP_SECRET"
    KIS_HTS_ID = "KIS_HTS_ID"
    KIS_ACCESS_TOKEN = "KIS_ACCESS_TOKEN"  # 내부용: 접근 토큰 캐시(JSON)
    KIS_WS_APPROVAL_KEY = "KIS_WS_APPROVAL_KEY"  # 내부용: WebSocket 승인키 캐시
    LLM_ANTHROPIC_KEY = "LLM_ANTHROPIC_KEY"
    LLM_OPENAI_KEY = "LLM_OPENAI_KEY"
    LLM_GOOGLE_KEY = "LLM_GOOGLE_KEY"
    LLM_COMPAT_KEY = "LLM_COMPAT_KEY"
    LLM_COMPAT_BASE_URL = "LLM_COMPAT_BASE_URL"


# 사용자가 화면에서 입력하는 값. 내부 캐시는 API로 쓰거나 볼 수 없다.
USER_SETTABLE: tuple[SecretName, ...] = tuple(
    n for n in SecretName if n not in (SecretName.KIS_ACCESS_TOKEN, SecretName.KIS_WS_APPROVAL_KEY)
)


BrokerSecretField = Literal["APP_KEY", "APP_SECRET", "ACCOUNT", "TOKEN"]
# 저장된 증권사 비밀키의 이름 목록. 키링은 목록을 주지 않아 저장소 안에 함께 둔다(이름만).
BROKER_INDEX = "BROKER_SECRET_NAMES"


def broker_secret(conn_id: int, field: BrokerSecretField) -> str:
    """증권사 연결별 비밀키 이름. API로는 읽거나 쓸 수 없다(`USER_SETTABLE`에 없음)."""
    return f"BROKER_{conn_id}_{field}"
