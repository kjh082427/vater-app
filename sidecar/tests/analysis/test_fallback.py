"""Gemini 대기와 대체 모델 (v2 설계 20장). 실제 Gemini는 부르지 않고 가짜 응답과 오류를 쓴다."""

import threading
from types import SimpleNamespace
from typing import Any

import pytest
from google.genai import errors, types
from pydantic import BaseModel

from vater_core.analysis.engine import Cancelled
from vater_core.analysis.fallback import BUDGET_SEC, GeminiFallback, install
from vater_core.api.errors import VaterError

QUICK = ("gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite")


def busy() -> errors.APIError:
    return errors.ServerError(
        503, {"error": {"code": 503, "message": "overloaded", "status": "UNAVAILABLE"}}
    )


def limited(quota: str, delay: str | None = "25s") -> errors.APIError:
    details: list[dict[str, Any]] = [
        {
            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
            "violations": [{"quotaMetric": "m", "quotaId": quota}],
        }
    ]
    if delay is not None:
        details.append({"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": delay})
    body = {"code": 429, "message": "quota", "status": "RESOURCE_EXHAUSTED", "details": details}
    return errors.ClientError(429, {"error": body})


PER_MINUTE = "GenerateRequestsPerMinutePerProjectPerModel-FreeTier"
PER_DAY = "GenerateRequestsPerDayPerProjectPerModel-FreeTier"


def bad_key() -> errors.APIError:
    body = {
        "code": 400,
        "message": "API key not valid.",
        "status": "INVALID_ARGUMENT",
        "details": [
            {"@type": "type.googleapis.com/google.rpc.ErrorInfo", "reason": "API_KEY_INVALID"}
        ],
    }
    return errors.ClientError(400, {"error": body})


def answer(part: types.Part) -> types.GenerateContentResponse:
    content = types.Content(role="model", parts=[part])
    return types.GenerateContentResponse(
        candidates=[types.Candidate(content=content, finish_reason=types.FinishReason.STOP)]
    )


class FakeModels:
    """모델 이름별로 낼 오류를 차례로 낸다. 오류가 다 떨어지면 `reply`로 답한다."""

    def __init__(self, script: dict[str, list[Exception]], reply: Any = None) -> None:
        self.script = script
        self.reply = reply or answer(types.Part(text="ok"))
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def generate_content(self, *, model: str, **request: Any) -> Any:
        self.calls.append((model, request))
        queue = self.script.get(model, [])
        if queue:
            raise queue.pop(0)
        return self.reply

    def count_tokens(self, **_: Any) -> str:
        return "forwarded"


class Recorder:
    def __init__(self) -> None:
        self.waits: list[tuple[str, str, float]] = []
        self.slept: list[float] = []

    def wait(self, seconds: float) -> None:
        self.slept.append(seconds)

    def on_wait(self, reason: str, model: str, seconds: float) -> None:
        self.waits.append((reason, model, seconds))


def fallback(models: FakeModels, rec: Recorder, chain: tuple[str, ...] = QUICK) -> GeminiFallback:
    return GeminiFallback(models, chain, rec.wait, rec.on_wait)


def called(models: FakeModels) -> list[str]:
    return [m for m, _ in models.calls]


def test_busy_waits_longer_each_time_then_answers() -> None:
    models, rec = FakeModels({QUICK[0]: [busy(), busy(), busy()]}), Recorder()
    fb = fallback(models, rec)
    assert fb.generate_content(model=QUICK[0], contents="hi") is models.reply
    assert called(models) == [QUICK[0]] * 4
    assert [r for r, _, _ in rec.waits] == ["busy"] * 3
    assert rec.slept == sorted(rec.slept) and rec.slept[0] < rec.slept[-1]
    assert fb.used == []  # 설정한 모델이 답했다


def test_rate_limit_waits_retry_delay() -> None:
    models, rec = FakeModels({QUICK[0]: [limited(PER_MINUTE, "27.5s")]}), Recorder()
    fallback(models, rec).generate_content(model=QUICK[0], contents="hi")
    assert rec.waits == [("rate", QUICK[0], 27.5)]


def test_gives_up_on_model_after_budget_and_sticks_to_next() -> None:
    models = FakeModels({QUICK[0]: [limited(PER_MINUTE, "30s") for _ in range(20)]})
    rec = Recorder()
    fb = fallback(models, rec)
    fb.generate_content(model=QUICK[0], contents="a")
    assert sum(rec.slept) <= BUDGET_SEC and sum(rec.slept) >= BUDGET_SEC - 30
    assert called(models)[-1] == QUICK[1] and fb.used == [QUICK[1]]
    models.calls.clear()
    fb.generate_content(model=QUICK[0], contents="b")  # 다음 호출은 넘어간 모델로 바로 간다
    assert called(models) == [QUICK[1]]


def test_daily_limit_moves_on_without_waiting() -> None:
    models, rec = FakeModels({QUICK[0]: [limited(PER_DAY)]}), Recorder()
    fb = fallback(models, rec)
    fb.generate_content(model=QUICK[0], contents="hi")
    assert called(models) == [QUICK[0], QUICK[1]] and rec.slept == [] and fb.used == [QUICK[1]]


def test_all_daily_limited_is_daily_limit_error() -> None:
    models = FakeModels({m: [limited(PER_DAY)] for m in QUICK})
    fb = fallback(models, Recorder())
    with pytest.raises(VaterError) as e:
        fb.generate_content(model=QUICK[0], contents="hi")
    assert e.value.code == "LLM_DAILY_LIMIT"
    assert (
        e.value.message
        == "오늘 무료 사용량을 다 썼습니다. 내일 다시 시도하거나 로컬 AI로 바꿔 주세요."
    )
    models.calls.clear()
    with pytest.raises(VaterError):  # 다 쓴 뒤의 호출은 다시 보내지 않는다
        fb.generate_content(model=QUICK[0], contents="again")
    assert models.calls == []


@pytest.mark.parametrize(
    ("make", "code"), [(busy, "LLM_BUSY"), (lambda: limited(PER_MINUTE), "LLM_RATE_LIMITED")]
)
def test_exhausted_chain_reports_last_reason(make: Any, code: str) -> None:
    models = FakeModels({m: [make() for _ in range(50)] for m in QUICK})
    with pytest.raises(VaterError) as e:
        fallback(models, Recorder()).generate_content(model=QUICK[0], contents="hi")
    assert e.value.code == code
    assert (
        e.value.message
        == "분석을 끝내지 못했습니다. 마친 단계는 저장됐으니 잠시 뒤 [다시 시도]를 눌러 주세요."
    )
    assert set(called(models)) == set(QUICK)


@pytest.mark.parametrize(
    "error", [bad_key, lambda: errors.ClientError(401, {}), lambda: errors.ClientError(403, {})]
)
def test_key_errors_are_not_retried(error: Any) -> None:
    models, rec = FakeModels({QUICK[0]: [error()]}), Recorder()
    with pytest.raises(VaterError) as e:
        fallback(models, rec).generate_content(model=QUICK[0], contents="hi")
    assert e.value.code == "LLM_KEY_INVALID"
    assert called(models) == [QUICK[0]] and rec.slept == []


def test_other_errors_pass_through() -> None:
    models = FakeModels({QUICK[0]: [errors.ClientError(400, {"error": {"message": "bad"}})]})
    with pytest.raises(errors.ClientError):
        fallback(models, Recorder()).generate_content(model=QUICK[0], contents="hi")
    assert called(models) == [QUICK[0]]


def test_cancel_during_wait() -> None:
    models = FakeModels({QUICK[0]: [busy()]})
    cancel = threading.Event()
    cancel.set()

    def wait(seconds: float) -> None:
        if cancel.wait(seconds):
            raise Cancelled

    with pytest.raises(Cancelled):
        GeminiFallback(models, QUICK, wait, lambda *a: None).generate_content(model=QUICK[0])


class Verdict(BaseModel):
    rating: str


def test_tools_and_structured_output_survive_fallback() -> None:
    """TradingAgents가 만든 Gemini 모델 그대로: 도구 호출과 구조화 출력이 대체 모델에서도 같다."""
    from langchain_core.tools import tool
    from tradingagents.llm_clients.google_client import GoogleClient

    @tool
    def get_price(code: str) -> str:
        """현재가."""
        return code

    llm = GoogleClient(QUICK[0], api_key="fake-key", max_retries=2).get_llm()
    call = answer(
        types.Part(function_call=types.FunctionCall(name="get_price", args={"code": "A"}))
    )
    models = FakeModels({QUICK[0]: [limited(PER_DAY)]}, reply=call)
    llm.client = SimpleNamespace(models=models)
    rec = Recorder()
    fb = install(llm, QUICK, rec.wait, rec.on_wait)

    out = llm.bind_tools([get_price]).invoke("price?")
    assert out.tool_calls[0]["name"] == "get_price" and out.tool_calls[0]["args"] == {"code": "A"}
    assert called(models) == [QUICK[0], QUICK[1]] and fb.used == [QUICK[1]]
    sent = models.calls[-1][1]["config"]
    assert sent.tools and sent.tools[0].function_declarations[0].name == "get_price"
    assert sent.http_options.retry_options.attempts == 1  # SDK의 짧은 재시도는 끈다

    models.reply = answer(types.Part(text='{"rating": "Buy"}'))
    assert llm.with_structured_output(Verdict).invoke("verdict?") == Verdict(rating="Buy")
    assert models.calls[-1][0] == QUICK[1]
    assert llm.client.models.count_tokens() == "forwarded"


def test_engine_attaches_only_to_google_tiers_and_reports_waits() -> None:
    from tradingagents.llm_clients.google_client import GoogleClient

    from vater_core.analysis.engine import attach_fallbacks
    from vater_core.analysis.models import Progress
    from vater_core.llm.presets import LlmRun, TierChoice

    def gemini(model: str) -> Any:
        return GoogleClient(model, api_key="fake-key").get_llm()

    ta = SimpleNamespace(
        deep_thinking_llm=gemini("gemini-3.8-flash"), quick_thinking_llm=gemini(QUICK[0])
    )
    fake = FakeModels({QUICK[0]: [busy()]})
    ta.quick_thinking_llm.client = SimpleNamespace(models=fake)
    tier = TierChoice("google", "m", None)
    run = LlmRun("cloud", tier, tier, {}, {}, {"deep": ("gemini-3.8-flash",), "quick": QUICK})
    seen: list[Progress] = []
    fbs = attach_fallbacks(ta, run, seen.append, lambda s: None, t0=0.0)
    assert set(fbs) == {"deep", "quick"}
    assert isinstance(ta.deep_thinking_llm.client.models, GeminiFallback)
    assert ta.quick_thinking_llm.invoke("hi").content == "ok"
    assert [(p.stage, p.node) for p in seen] == [("other", QUICK[0])]
    assert seen[0].wait == {
        "reason": "busy",
        "message": "구글 AI 서버가 혼잡합니다. 잠시 후 자동으로 다시 시도합니다.",
        "seconds": 5.0,
    }

    mixed = LlmRun("mixed", tier, tier, {}, {}, {"deep": ("gemini-3.8-flash",)})
    other = SimpleNamespace(
        deep_thinking_llm=gemini("gemini-3.8-flash"), quick_thinking_llm=object()
    )
    assert set(attach_fallbacks(other, mixed, seen.append, lambda s: None, t0=0.0)) == {"deep"}
    assert (
        attach_fallbacks(other, LlmRun("local", tier, tier, {}, {}), seen.append, print, 0.0) == {}
    )
