"""비밀키 이름. 개발용 `.env`의 키 이름과 같다 (`.env.example` 참고)."""

from enum import StrEnum


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
