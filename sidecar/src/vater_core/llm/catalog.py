"""모델 카탈로그 (`catalog.json`, 앱 업데이트 때 함께 갱신). 스펙 3-3.

기본값의 근거는 검증 실험 보고서(`spikes/tradingagents-local-llm/REPORT.md`)의 S1·S8이다.
"""

import json
from dataclasses import dataclass
from functools import cache
from importlib.resources import files
from typing import Any, Literal, cast

from vater_core.api.errors import VaterError
from vater_core.secrets.names import SecretName

TierId = Literal["nvidia_24", "nvidia_12", "nvidia_8", "integrated"]
CloudProviderId = Literal["google", "anthropic", "openai", "compat"]


@dataclass(frozen=True)
class Tier:
    id: TierId
    label: str
    min_vram_mb: int
    default_preset: str
    recommended: str | None
    alternatives: tuple[str, ...]
    expected_minutes: int | None  # 분석 1건 예상 시간(검증 실험 측정값). 모르면 None


@dataclass(frozen=True)
class LocalModel:
    tag: str
    label: str
    size_gb: float
    num_ctx: int
    min_vram_mb: int
    note: str

    @property
    def variant(self) -> str:
        """`num_ctx`를 고정한 Ollama 변형 이름. TradingAgents에 `num_ctx` 설정이 없어서 쓴다."""
        return f"{self.tag}-{self.num_ctx // 1024}k"


@dataclass(frozen=True)
class CloudProvider:
    id: CloudProviderId
    label: str
    ta_provider: str  # TradingAgents의 llm_provider 값
    secret: SecretName
    base_url_secret: SecretName | None
    deep: str | None
    quick: str | None
    free_tier: bool


@dataclass(frozen=True)
class Catalog:
    version: str
    tiers: tuple[Tier, ...]
    local_models: tuple[LocalModel, ...]
    cloud: dict[CloudProviderId, CloudProvider]

    def tier(self, id: str) -> Tier:
        for t in self.tiers:
            if t.id == id:
                return t
        raise KeyError(id)

    def local(self, tag: str) -> LocalModel:
        for m in self.local_models:
            if m.tag == tag:
                return m
        raise VaterError(
            "LLM_MODEL_UNKNOWN",
            f"카탈로그에 없는 모델입니다: '{tag}'",
            hint="설정 화면의 추천 모델 목록에서 고르세요.",
            status=404,
        )

    def tier_for_vram(self, vram_mb: int | None) -> Tier:
        """VRAM이 기준 이상인 등급 중 가장 높은 것. GPU가 없으면 내장 GPU 등급."""
        for t in sorted(self.tiers, key=lambda t: t.min_vram_mb, reverse=True):
            if vram_mb is not None and vram_mb >= t.min_vram_mb:
                return t
        return self.tier("integrated")


def _parse(raw: dict[str, Any]) -> Catalog:
    tiers = tuple(
        Tier(
            id=t["id"],
            label=t["label"],
            min_vram_mb=t["min_vram_mb"],
            default_preset=t["default_preset"],
            recommended=t["recommended"],
            alternatives=tuple(t["alternatives"]),
            expected_minutes=t["expected_minutes"],
        )
        for t in raw["tiers"]
    )
    models = tuple(LocalModel(**m) for m in raw["local_models"])
    cloud = {
        cast(CloudProviderId, pid): CloudProvider(
            id=cast(CloudProviderId, pid),
            label=p["label"],
            ta_provider=p["ta_provider"],
            secret=SecretName(p["secret"]),
            base_url_secret=SecretName(p["base_url_secret"]) if p["base_url_secret"] else None,
            deep=p["deep"],
            quick=p["quick"],
            free_tier=p["free_tier"],
        )
        for pid, p in raw["cloud"].items()
    }
    return Catalog(version=raw["version"], tiers=tiers, local_models=models, cloud=cloud)


@cache
def load_catalog() -> Catalog:
    text = files("vater_core.llm").joinpath("catalog.json").read_text(encoding="utf-8")
    return _parse(json.loads(text))


def catalog_tags() -> tuple[str, ...]:
    return tuple(m.tag for m in load_catalog().local_models)
