import pytest

from vater_core.api.errors import VaterError
from vater_core.llm.catalog import load_catalog
from vater_core.secrets.names import USER_SETTABLE, SecretName


def test_every_tier_model_is_in_catalog() -> None:
    cat = load_catalog()
    tags = {m.tag for m in cat.local_models}
    for tier in cat.tiers:
        wanted = ([tier.recommended] if tier.recommended else []) + list(tier.alternatives)
        assert set(wanted) <= tags, tier.id


@pytest.mark.parametrize(
    ("vram", "tier"),
    [
        (None, "integrated"),
        (4096, "integrated"),
        (7499, "integrated"),
        (7500, "nvidia_8"),
        (8192, "nvidia_8"),
        (11500, "nvidia_12"),
        (16384, "nvidia_12"),
        (23000, "nvidia_24"),
        (24576, "nvidia_24"),
    ],
)
def test_tier_for_vram_boundaries(vram: int | None, tier: str) -> None:
    assert load_catalog().tier_for_vram(vram).id == tier


def test_variant_name() -> None:
    cat = load_catalog()
    assert cat.local("qwen3.5:4b").variant == "qwen3.5:4b-16k"
    assert cat.local("qwen3.8:27b").variant == "qwen3.8:27b-32k"


def test_unknown_model_raises() -> None:
    with pytest.raises(VaterError) as e:
        load_catalog().local("nope:1b")
    assert e.value.code == "LLM_MODEL_UNKNOWN" and e.value.status == 404


def test_cloud_providers_use_known_secrets() -> None:
    cloud = load_catalog().cloud
    assert set(cloud) == {"google", "anthropic", "openai", "compat"}
    for provider in cloud.values():
        assert provider.secret in USER_SETTABLE
        expected = SecretName.LLM_COMPAT_BASE_URL if provider.id == "compat" else None
        assert provider.base_url_secret == expected


def test_integrated_defaults_to_cloud() -> None:
    tier = load_catalog().tier("integrated")
    assert tier.default_preset == "cloud" and tier.recommended is None
