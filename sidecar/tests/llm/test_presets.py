from pathlib import Path
from typing import Any

import pytest

from vater_core.api.errors import VaterError
from vater_core.llm.catalog import load_catalog
from vater_core.llm.ollama import OLLAMA_V1
from vater_core.llm.presets import Preset, build_run
from vater_core.secrets.names import SecretName
from vater_core.secrets.store import EnvFileSecretStore
from vater_core.store.settings import SETTING_DEFS

KEYS = {
    SecretName.LLM_GOOGLE_KEY: "g-key-123",
    SecretName.LLM_ANTHROPIC_KEY: "a-key-456",
    SecretName.LLM_OPENAI_KEY: "o-key-789",
    SecretName.LLM_COMPAT_KEY: "c-key-000",
    SecretName.LLM_COMPAT_BASE_URL: "https://user:pw@llm.example/v1",
}


def settings(**changes: Any) -> dict[str, Any]:
    values = {k: d.default for k, d in SETTING_DEFS.items()}
    values.update({k.replace("__", "."): v for k, v in changes.items()})
    return values


def store(tmp_path: Path, *names: SecretName) -> EnvFileSecretStore:
    s = EnvFileSecretStore(tmp_path / ".env")
    for n in names:
        s.set(n, KEYS[n])
    return s


def code(fn: Any) -> tuple[str, int]:
    with pytest.raises(VaterError) as e:
        fn()
    return e.value.code, e.value.status


def test_cloud_google_defaults(tmp_path: Path) -> None:
    run = build_run(settings(), load_catalog(), store(tmp_path, SecretName.LLM_GOOGLE_KEY))
    assert run.preset == "cloud"
    assert run.overrides == {
        "llm_provider": "google",
        "deep_think_llm": "gemini-3.8-flash",
        "quick_think_llm": "gemini-3.5-flash-lite",
        "backend_url": None,
        "output_language": "Korean",
        "max_debate_rounds": 1,
        "max_risk_discuss_rounds": 1,
    }
    assert run.env == {"GOOGLE_API_KEY": "g-key-123"}


def test_cloud_model_overrides(tmp_path: Path) -> None:
    s = settings(llm__cloud_deep_model="gemini-3.1-pro-preview", analysis__debate_rounds=2)
    run = build_run(s, load_catalog(), store(tmp_path, SecretName.LLM_GOOGLE_KEY))
    assert run.overrides["deep_think_llm"] == "gemini-3.1-pro-preview"
    assert run.overrides["quick_think_llm"] == "gemini-3.5-flash-lite"
    assert run.overrides["max_debate_rounds"] == 2 == run.overrides["max_risk_discuss_rounds"]


def test_local_uses_variant_for_both(tmp_path: Path) -> None:
    s = settings(llm__preset="local", llm__local_model="qwen3.5:4b")
    run = build_run(s, load_catalog(), store(tmp_path))
    assert run.overrides["llm_provider"] == "ollama"
    assert run.overrides["backend_url"] == OLLAMA_V1
    assert run.overrides["deep_think_llm"] == "qwen3.5:4b-16k"
    assert run.overrides["quick_think_llm"] == "qwen3.5:4b-16k"
    assert "quick_think_provider" not in run.overrides
    assert run.env == {}


def test_mixed_splits_tiers(tmp_path: Path) -> None:
    s = settings(llm__cloud_provider="anthropic", llm__local_model="qwen3.5:4b")
    run = build_run(
        s, load_catalog(), store(tmp_path, SecretName.LLM_ANTHROPIC_KEY), preset="mixed"
    )
    o = run.overrides
    assert o["llm_provider"] == "anthropic" and o["deep_think_llm"] == "claude-sonnet-5-5"
    assert o["backend_url"] is None
    assert o["quick_think_provider"] == "ollama"
    assert o["quick_think_backend_url"] == OLLAMA_V1
    assert o["quick_think_llm"] == "qwen3.5:4b-16k"
    assert run.env == {"ANTHROPIC_API_KEY": "a-key-456"}
    assert (run.deep.provider, run.quick.provider) == ("anthropic", "ollama")


def test_compat_uses_base_url_secret(tmp_path: Path) -> None:
    s = settings(
        llm__cloud_provider="compat", llm__cloud_deep_model="big", llm__cloud_quick_model="small"
    )
    secrets = store(tmp_path, SecretName.LLM_COMPAT_KEY, SecretName.LLM_COMPAT_BASE_URL)
    run = build_run(s, load_catalog(), secrets)
    assert run.overrides["llm_provider"] == "openai_compatible"
    assert run.overrides["backend_url"] == KEYS[SecretName.LLM_COMPAT_BASE_URL]
    assert (run.overrides["deep_think_llm"], run.overrides["quick_think_llm"]) == ("big", "small")
    assert run.env == {"OPENAI_COMPATIBLE_API_KEY": "c-key-000"}
    assert run.deep.base_url is None  # 주소에 자격 증명이 섞일 수 있어 요약에는 남기지 않는다


def test_compat_without_models_or_url(tmp_path: Path) -> None:
    cat = load_catalog()
    full = store(tmp_path, SecretName.LLM_COMPAT_KEY, SecretName.LLM_COMPAT_BASE_URL)
    no_models = settings(llm__cloud_provider="compat")
    assert code(lambda: build_run(no_models, cat, full)) == ("LLM_KEY_MISSING", 409)
    no_url = EnvFileSecretStore(tmp_path / "other.env")
    no_url.set(SecretName.LLM_COMPAT_KEY, "c")
    s = settings(
        llm__cloud_provider="compat", llm__cloud_deep_model="big", llm__cloud_quick_model="small"
    )
    with pytest.raises(VaterError) as e:
        build_run(s, cat, no_url)
    assert e.value.code == "LLM_KEY_MISSING" and "LLM_COMPAT_BASE_URL" in (e.value.hint or "")


@pytest.mark.parametrize("preset", ["cloud", "mixed"])
def test_missing_key_blocks_cloud_and_mixed(tmp_path: Path, preset: Preset) -> None:
    s = settings(llm__local_model="qwen3.5:4b")
    assert code(lambda: build_run(s, load_catalog(), store(tmp_path), preset=preset)) == (
        "LLM_KEY_MISSING",
        409,
    )
    build_run(s, load_catalog(), store(tmp_path), preset="local")  # 로컬은 키가 필요 없다


@pytest.mark.parametrize("preset", ["local", "mixed"])
def test_missing_local_model_blocks_local_and_mixed(tmp_path: Path, preset: Preset) -> None:
    secrets = store(tmp_path, SecretName.LLM_GOOGLE_KEY)
    assert code(lambda: build_run(settings(), load_catalog(), secrets, preset=preset)) == (
        "LLM_LOCAL_MODEL_MISSING",
        409,
    )


@pytest.mark.parametrize("preset", ["cloud", "local", "mixed"])
@pytest.mark.parametrize("provider", ["google", "anthropic", "openai", "compat"])
def test_secrets_never_in_overrides_or_repr(tmp_path: Path, preset: Preset, provider: str) -> None:
    s = settings(
        llm__cloud_provider=provider,
        llm__local_model="qwen3.5:4b",
        llm__cloud_deep_model="big" if provider == "compat" else "",
        llm__cloud_quick_model="small" if provider == "compat" else "",
    )
    run = build_run(s, load_catalog(), store(tmp_path, *KEYS), preset=preset)
    key_values = [v for n, v in KEYS.items() if n != SecretName.LLM_COMPAT_BASE_URL]
    for value in run.overrides.values():
        assert all(k not in str(value) for k in key_values)
    text = repr(run) + run.summary()
    assert all(v not in text for v in KEYS.values())


def test_summary(tmp_path: Path) -> None:
    s = settings(llm__local_model="qwen3.5:4b")
    run = build_run(s, load_catalog(), store(tmp_path, SecretName.LLM_GOOGLE_KEY), preset="mixed")
    assert run.summary() == "mixed: deep google/gemini-3.8-flash, quick ollama/qwen3.5:4b-16k"
