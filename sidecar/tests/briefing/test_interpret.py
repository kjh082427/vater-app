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


# ---- 재시도와 대체 모델 (v2 설계 21장 5번, 20장) ------------------------------------

DEEP = ("gemini-3.8-flash", "gemini-3.5-flash", "gemini-2.5-flash")


def gemini_run(
    chains: dict[str, tuple[str, ...]] | None = None, provider: str = "google"
) -> LlmRun:
    overrides = {
        "llm_provider": provider,
        "deep_think_llm": DEEP[0],
        "quick_think_llm": DEEP[0],
        "backend_url": None,
    }
    tier = TierChoice(provider, DEEP[0], None)
    chains = {"deep": DEEP} if chains is None else chains
    return LlmRun("cloud", tier, tier, overrides, {"GOOGLE_API_KEY": "g-key"}, chains)


class FakeModels:
    """모델 이름별로 낼 오류를 차례로 낸다. 오류가 다 떨어지면 해석을 답한다."""

    def __init__(self, script: dict[str, list[Exception]]) -> None:
        from google.genai import types

        self.script = script
        self.calls: list[str] = []
        part = types.Part(text=json.dumps(GOOD, ensure_ascii=False))
        content = types.Content(role="model", parts=[part])
        self.reply = types.GenerateContentResponse(
            candidates=[types.Candidate(content=content, finish_reason=types.FinishReason.STOP)]
        )

    def generate_content(self, *, model: str, **request: Any) -> Any:
        self.calls.append(model)
        queue = self.script.get(model, [])
        if queue:
            raise queue.pop(0)
        return self.reply


def overloaded() -> Exception:
    from google.genai import errors

    return errors.ServerError(
        503, {"error": {"code": 503, "message": "overloaded", "status": "UNAVAILABLE"}}
    )


def real_model(
    monkeypatch: pytest.MonkeyPatch, script: dict[str, list[Exception]], run_: LlmRun
) -> tuple[Any, FakeModels, list[float]]:
    """진짜 `deep_model`이 만든 Gemini 모델. 네트워크 대신 가짜 `models`를 끼우고 잠은 건너뛴다."""
    import time

    from vater_core.analysis.fallback import GeminiFallback
    from vater_core.briefing.interpret import deep_model

    slept: list[float] = []
    monkeypatch.setattr(time, "sleep", slept.append)
    model = deep_model(run_)
    fake = FakeModels(script)
    assert isinstance(model.client.models, GeminiFallback)
    model.client.models._models = fake
    return model, fake, slept


def test_google_deep_model_waits_and_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    """실제 로그의 503: 첫 모델이 계속 혼잡해도 대체 모델이 해석을 만든다."""
    from vater_core.analysis.fallback import BUDGET_SEC

    script = {DEEP[0]: [overloaded() for _ in range(50)]}
    model, fake, slept = real_model(monkeypatch, script, gemini_run())
    assert interpret("KR", DATA, gemini_run(), factory=lambda r: model) == GOOD
    assert fake.calls[-1] == DEEP[1] and set(fake.calls) == {DEEP[0], DEEP[1]}
    assert 0 < sum(slept) <= BUDGET_SEC


def rate_limited() -> Exception:
    from google.genai import errors

    quota = "GenerateRequestsPerMinutePerProjectPerModel-FreeTier"
    details = [{"violations": [{"quotaId": quota}]}, {"retryDelay": "30s"}]
    body = {"code": 429, "message": "quota", "status": "RESOURCE_EXHAUSTED", "details": details}
    return errors.ClientError(429, {"error": body})


@pytest.mark.parametrize(
    ("make", "code"), [(overloaded, "LLM_BUSY"), (rate_limited, "LLM_RATE_LIMITED")]
)
def test_exhausted_chain_keeps_the_reason_with_briefing_wording(
    monkeypatch: pytest.MonkeyPatch, make: Any, code: str
) -> None:
    script = {m: [make() for _ in range(80)] for m in DEEP}
    model, _, _ = real_model(monkeypatch, script, gemini_run())
    with pytest.raises(VaterError) as e:
        interpret("KR", DATA, gemini_run(), factory=lambda r: model)
    assert e.value.code == code
    assert "분석" not in e.value.message and "해석" in e.value.message


def test_daily_limit_and_key_errors_keep_their_codes() -> None:
    for code in ("LLM_DAILY_LIMIT", "LLM_KEY_INVALID"):
        model = Model(error=VaterError(code, "원문", status=429))
        with pytest.raises(VaterError) as e:
            interpret("KR", DATA, run(), factory=lambda r, m=model: m)
        assert (e.value.code, e.value.message) == (code, "원문")


@pytest.mark.parametrize(
    "run_",
    [
        gemini_run({}),  # 로컬 프리셋과 대체 목록이 없는 공급자
        gemini_run({"deep": ("a", "b")}, provider="anthropic"),
    ],
)
def test_only_google_gets_the_fallback(monkeypatch: pytest.MonkeyPatch, run_: LlmRun) -> None:
    from vater_core.analysis.fallback import GeminiFallback
    from vater_core.briefing.interpret import deep_model

    monkeypatch.setattr("tradingagents.llm_clients.factory.create_tier_client", _plain_client)
    model = deep_model(run_)
    assert not isinstance(getattr(getattr(model, "client", None), "models", None), GeminiFallback)


class _plain_client:
    def __init__(self, config: Any, tier: str, **keys: Any) -> None:
        pass

    def get_llm(self) -> Any:
        return object()
