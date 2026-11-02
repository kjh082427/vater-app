"""클라우드 LLM 키 연결 테스트: 토큰을 쓰지 않는 모델 목록 API를 한 번 부른다.

키는 헤더로만 보낸다(URL 쿼리에 넣으면 프록시나 로그에 남을 수 있다).
오류 메시지에는 제공자 응답 본문을 넣지 않는다(키가 되돌아올 수 있다).
"""

import logging
from dataclasses import dataclass
from typing import Any

import httpx

from vater_core.api.errors import VaterError
from vater_core.llm.catalog import CloudProvider, CloudProviderId
from vater_core.secrets.store import SecretStore

logger = logging.getLogger(__name__)

TIMEOUT = 15.0
GOOGLE_MODELS = "https://generativelanguage.googleapis.com/v1beta/models"
ANTHROPIC_MODELS = "https://api.anthropic.com/v1/models"
OPENAI_MODELS = "https://api.openai.com/v1/models"


@dataclass(frozen=True)
class CloudTestResult:
    provider: CloudProviderId
    ok: bool
    model_count: int
    defaults_available: bool  # 카탈로그 기본 deep·quick 모델이 이 키로 보이는지


def _missing(p: CloudProvider, name: str) -> VaterError:
    return VaterError(
        "LLM_KEY_MISSING",
        f"{p.label} 설정이 비어 있습니다.",
        hint=f"설정 > AI에서 {name}을 입력하세요.",
        status=409,
    )


def _request(p: CloudProvider, key: str, base_url: str | None) -> tuple[str, dict[str, str]]:
    if p.id == "google":
        return f"{GOOGLE_MODELS}?pageSize=1000", {"x-goog-api-key": key}
    if p.id == "anthropic":
        return f"{ANTHROPIC_MODELS}?limit=1000", {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
        }
    if p.id == "openai":
        return OPENAI_MODELS, {"Authorization": f"Bearer {key}"}
    return f"{(base_url or '').rstrip('/')}/models", {"Authorization": f"Bearer {key}"}


def _model_ids(p: CloudProvider, body: Any) -> set[str]:
    if p.id == "google":
        return {str(m.get("name", "")).removeprefix("models/") for m in body.get("models", [])}
    return {str(m.get("id", "")) for m in body.get("data", [])}


async def check_cloud_key(
    http: httpx.AsyncClient, provider: CloudProvider, secrets: SecretStore
) -> CloudTestResult:
    key = secrets.get(provider.secret)
    if not key:
        raise _missing(provider, f"API 키({provider.secret.value})")
    base_url = None
    if provider.base_url_secret is not None:
        base_url = secrets.get(provider.base_url_secret)
        if not base_url:
            raise _missing(provider, f"서버 주소({provider.base_url_secret.value})")
    url, headers = _request(provider, key, base_url)
    try:
        r = await http.get(url, headers=headers, timeout=TIMEOUT)
    except httpx.HTTPError as e:
        logger.info("cloud key test unreachable: %s %s", provider.id, type(e).__name__)
        raise VaterError(
            "LLM_UNREACHABLE",
            f"{provider.label} 서버에 연결하지 못했습니다.",
            hint="인터넷 연결이나 서버 주소를 확인하세요.",
            status=503,
        ) from e
    if r.status_code in (401, 403):
        raise VaterError(
            "LLM_KEY_INVALID",
            f"{provider.label} 키가 거부되었습니다.",
            hint="키를 다시 복사해 입력하거나 새 키를 만드세요.",
            status=400,
        )
    if r.status_code >= 400:
        logger.info("cloud key test http %s: %s", r.status_code, provider.id)
        raise VaterError(
            "LLM_UNREACHABLE",
            f"{provider.label} 서버가 오류를 돌려주었습니다 (HTTP {r.status_code}).",
            hint="잠시 뒤 다시 시도하세요.",
            status=503,
        )
    try:
        ids = _model_ids(provider, r.json())
    except (ValueError, AttributeError) as e:
        raise VaterError(
            "LLM_UNREACHABLE",
            f"{provider.label} 응답 형식을 읽지 못했습니다.",
            hint="서버 주소가 OpenAI 호환 API인지 확인하세요.",
            status=503,
        ) from e
    wanted = {m for m in (provider.deep, provider.quick) if m}
    return CloudTestResult(provider.id, True, len(ids), wanted <= ids)
