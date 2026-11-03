import json
import os
from typing import Any

import pytest

from vater_core.api.errors import VaterError
from vater_core.briefing.interpret import (
    SECTIONS,
    _key_kwargs,
    build_messages,
    interpret,
    parse_text,
)
from vater_core.llm.presets import LlmRun, TierChoice

DATA = {"market": "KR", "session": "2026-11-03", "indices": [{"name": "KOSPI", "change_pct": 1.2}]}
GOOD = {
    "headline": "반도체가 시장을 이끌었다.",
    "market": "코스피와 코스닥이 함께 올랐다.",
    "sectors": "전기전자 업종이 강했다.",
    "flows": "외국인이 사고 개인이 팔았다.",
    "notable": "",
    "watchlist": "감시 종목은 대체로 올랐다.",
}


def run(provider: str = "google", env: dict[str, str] | None = None) -> LlmRun:
    tier = TierChoice(provider, "m", None)
    return LlmRun("cloud", tier, tier, {}, env if env is not None else {"GOOGLE_API_KEY": "g-key"})


class Reply:
    def __init__(self, content: Any) -> None:
        self.content = content


class Model:
    def __init__(self, content: Any = None, error: Exception | None = None) -> None:
        self.content = content
        self.error = error
        self.seen: list[tuple[str, str]] = []

    def invoke(self, messages: list[tuple[str, str]]) -> Reply:
        self.seen = messages
        if self.error is not None:
            raise self.error
        return Reply(self.content)


def test_messages_carry_the_data_and_the_no_numbers_rule() -> None:
    (role_s, system), (role_u, user) = build_messages("KR", DATA)
    assert (role_s, role_u) == ("system", "human")
    assert "숫자" in system and all(k in system for k in SECTIONS)
    assert json.dumps(DATA["indices"], ensure_ascii=False) in user
    assert "국내" in user


def test_parse_plain_and_fenced_json() -> None:
    assert parse_text(json.dumps(GOOD, ensure_ascii=False)) == GOOD
    fenced = "다음과 같습니다.\n```json\n" + json.dumps(GOOD, ensure_ascii=False) + "\n```\n끝."
    assert parse_text(fenced) == GOOD


def test_missing_keys_become_empty_and_extra_keys_are_dropped() -> None:
    got = parse_text('{"headline": "오늘은 조용했다.", "mood": "좋음"}')
    assert got == {k: ("오늘은 조용했다." if k == "headline" else "") for k in SECTIONS}


@pytest.mark.parametrize("raw", ["", "JSON이 아닙니다", '{"headline": 3}', "[1, 2]"])
def test_unreadable_output_is_an_llm_failure(raw: str) -> None:
    with pytest.raises(VaterError) as e:
        parse_text(raw)
    assert (e.value.code, e.value.status) == ("BRIEFING_LLM_FAILED", 502)


def test_sentences_with_numbers_are_dropped() -> None:
    raw = json.dumps(
        {
            "market": "코스피가 2.3% 올랐다. 반도체가 강했다!\n외국인이 1,200억원을 샀다.",
            "flows": "３조 순매수.",
        },
        ensure_ascii=False,
    )
    got = parse_text(raw)
    assert got["market"] == "반도체가 강했다!"
    assert got["flows"] == ""


def test_interpret_uses_the_model_and_block_content() -> None:
    model = Model([{"type": "text", "text": json.dumps(GOOD, ensure_ascii=False)}])
    assert interpret("KR", DATA, run(), factory=lambda r: model) == GOOD
    assert model.seen == build_messages("KR", DATA)


def test_model_error_becomes_llm_failure_without_the_raw_text() -> None:
    model = Model(error=RuntimeError("401 bad key g-key"))
    with pytest.raises(VaterError) as e:
        interpret("KR", DATA, run(), factory=lambda r: model)
    assert e.value.code == "BRIEFING_LLM_FAILED"
    assert "g-key" not in e.value.message and "RuntimeError" in e.value.message


def test_key_is_passed_as_an_argument_not_through_the_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    assert _key_kwargs(run("google", {"GOOGLE_API_KEY": "g-key"})) == {"api_key": "g-key"}
    assert _key_kwargs(run("anthropic", {"ANTHROPIC_API_KEY": "a-key"})) == {"api_key": "a-key"}
    assert _key_kwargs(run("ollama", {})) == {}
    before = dict(os.environ)
    interpret("KR", DATA, run(), factory=lambda r: Model(json.dumps(GOOD, ensure_ascii=False)))
    assert dict(os.environ) == before


def test_deep_model_wires_the_key_into_a_real_client(monkeypatch: pytest.MonkeyPatch) -> None:
    from vater_core.briefing.interpret import deep_model

    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    overrides = {
        "llm_provider": "google",
        "deep_think_llm": "gemini-3.8-flash",
        "quick_think_llm": "gemini-3.5-flash-lite",
        "backend_url": None,
    }
    tier = TierChoice("google", "gemini-3.8-flash", None)
    model = deep_model(LlmRun("cloud", tier, tier, overrides, {"GOOGLE_API_KEY": "g-key"}))
    assert model.google_api_key.get_secret_value() == "g-key"  # type: ignore[attr-defined]
    assert "GOOGLE_API_KEY" not in os.environ


ALL_KEY_ENVS = (
    "GOOGLE_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "OPENAI_COMPATIBLE_API_KEY",
)


@pytest.mark.filterwarnings("ignore:Model .* is not in the known model list")
@pytest.mark.parametrize(
    ("provider", "model", "base_url", "env_name", "attr"),
    [
        ("google", "gemini-3.8-flash", None, "GOOGLE_API_KEY", "google_api_key"),
        ("anthropic", "claude-sonnet-5-5", None, "ANTHROPIC_API_KEY", "anthropic_api_key"),
        ("openai", "gpt-6-sol", None, "OPENAI_API_KEY", "openai_api_key"),
        (
            "openai_compatible",
            "my-model",
            "http://localhost:8000/v1",
            "OPENAI_COMPATIBLE_API_KEY",
            "openai_api_key",
        ),
    ],
)
def test_every_catalog_provider_gets_the_key_without_env(
    monkeypatch: pytest.MonkeyPatch,
    provider: str,
    model: str,
    base_url: str | None,
    env_name: str,
    attr: str,
) -> None:
    from vater_core.briefing.interpret import deep_model

    for name in ALL_KEY_ENVS:
        monkeypatch.delenv(name, raising=False)
    overrides = {
        "llm_provider": provider,
        "deep_think_llm": model,
        "quick_think_llm": model,
        "backend_url": base_url,
    }
    tier = TierChoice(provider, model, base_url)
    llm = deep_model(LlmRun("cloud", tier, tier, overrides, {env_name: "the-key"}))
    assert getattr(llm, attr).get_secret_value() == "the-key"
    assert not any(name in os.environ for name in ALL_KEY_ENVS)


def test_null_for_a_section_means_empty() -> None:
    got = parse_text('{"headline": "오늘은 조용했다.", "sectors": null, "flows": null}')
    assert got["headline"] == "오늘은 조용했다." and got["sectors"] == "" and got["flows"] == ""
