"""프리셋 → TradingAgents 설정 덮어쓰기 + 환경변수 (스펙 3-1).

- `cloud`: quick·deep 모두 클라우드 / `local`: 모두 로컬 / `mixed`: quick 로컬, deep 클라우드
- **API 키는 환경변수로만 넘긴다.** 덮어쓰기 dict에는 키 값을 넣지 않는다
  (로그나 리포트에 섞이지 않게).
- 경로(`results_dir` 등)와 `checkpoint_enabled`는 분석 엔진(core/analysis)이 넣는다.
"""

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Literal, cast

from vater_core.api.errors import VaterError
from vater_core.llm.catalog import Catalog, CloudProvider, CloudProviderId
from vater_core.llm.ollama import OLLAMA_V1
from vater_core.secrets.store import SecretStore

Preset = Literal["cloud", "local", "mixed"]

# TradingAgents v0.7.1 `llm_clients/api_key_env.py`의 이름
ENV_FOR_PROVIDER: dict[str, str] = {
    "google": "GOOGLE_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
    "openai_compatible": "OPENAI_COMPATIBLE_API_KEY",
}


@dataclass(frozen=True)
class TierChoice:
    """요약·DB 기록용. 비밀이 들어갈 수 있는 값(compat 주소)은 담지 않는다."""

    provider: str
    model: str
    base_url: str | None


@dataclass(frozen=True)
class LlmRun:
    preset: Preset
    deep: TierChoice
    quick: TierChoice
    # compat 주소에는 자격 증명이 섞일 수 있어서 repr에서 숨긴다.
    overrides: dict[str, Any] = field(repr=False)
    env: dict[str, str] = field(repr=False)

    def summary(self) -> str:
        return (
            f"{self.preset}: deep {self.deep.provider}/{self.deep.model}, "
            f"quick {self.quick.provider}/{self.quick.model}"
        )


def _missing(what: str, hint: str) -> VaterError:
    return VaterError(
        "LLM_KEY_MISSING", f"클라우드 AI 설정이 비어 있습니다: {what}", hint=hint, status=409
    )


@dataclass(frozen=True)
class _Cloud:
    provider: CloudProvider
    deep: str
    quick: str
    base_url: str | None
    env: dict[str, str]


def _cloud(settings: Mapping[str, Any], catalog: Catalog, secrets: SecretStore) -> _Cloud:
    pid = cast(CloudProviderId, settings["llm.cloud_provider"])
    p = catalog.cloud[pid]
    key = secrets.get(p.secret)
    if not key:
        raise _missing(
            f"{p.label} API 키", f"설정 > AI에서 {p.label} 키({p.secret.value})를 입력하세요."
        )
    deep = settings["llm.cloud_deep_model"] or p.deep
    quick = settings["llm.cloud_quick_model"] or p.quick
    if not deep or not quick:
        raise _missing("모델 이름", "설정 > AI에서 deep·quick 모델 이름을 입력하세요.")
    base_url = None
    if p.base_url_secret is not None:
        base_url = secrets.get(p.base_url_secret)
        if not base_url:
            raise _missing(
                "서버 주소", f"설정 > AI에서 서버 주소({p.base_url_secret.value})를 입력하세요."
            )
    return _Cloud(p, deep, quick, base_url, {ENV_FOR_PROVIDER[p.ta_provider]: key})


def _local_variant(settings: Mapping[str, Any], catalog: Catalog) -> str:
    tag = settings["llm.local_model"]
    if not tag:
        raise VaterError(
            "LLM_LOCAL_MODEL_MISSING",
            "로컬 AI 모델을 아직 고르지 않았습니다.",
            hint="설정 > 로컬 AI에서 추천 모델을 받으세요.",
            status=409,
        )
    return catalog.local(tag).variant


def build_run(
    settings: Mapping[str, Any],
    catalog: Catalog,
    secrets: SecretStore,
    *,
    preset: Preset | None = None,
) -> LlmRun:
    chosen = cast(Preset, preset or settings["llm.preset"])
    common: dict[str, Any] = {
        "output_language": settings["llm.output_language"],
        "max_debate_rounds": settings["analysis.debate_rounds"],
        "max_risk_discuss_rounds": settings["analysis.debate_rounds"],
    }
    if chosen == "local":
        variant = _local_variant(settings, catalog)
        local = TierChoice("ollama", variant, OLLAMA_V1)
        local_overrides: dict[str, Any] = {
            "llm_provider": "ollama",
            "deep_think_llm": variant,
            "quick_think_llm": variant,
            "backend_url": OLLAMA_V1,
            **common,
        }
        return LlmRun(chosen, local, local, local_overrides, {})

    mixed_variant = _local_variant(settings, catalog) if chosen == "mixed" else None
    c = _cloud(settings, catalog, secrets)
    ta = c.provider.ta_provider
    shown_url = None if c.provider.base_url_secret else c.base_url
    overrides: dict[str, Any] = {
        "llm_provider": ta,
        "deep_think_llm": c.deep,
        "quick_think_llm": c.quick,
        "backend_url": c.base_url,
        **common,
    }
    deep = TierChoice(ta, c.deep, shown_url)
    quick = TierChoice(ta, c.quick, shown_url)
    if mixed_variant is not None:  # mixed: quick 단계만 로컬로 보낸다
        overrides.update(
            quick_think_provider="ollama",
            quick_think_backend_url=OLLAMA_V1,
            quick_think_llm=mixed_variant,
        )
        quick = TierChoice("ollama", mixed_variant, OLLAMA_V1)
    return LlmRun(chosen, deep, quick, overrides, c.env)
