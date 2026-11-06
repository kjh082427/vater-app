"""Gemini 무료 등급의 혼잡·한도를 기다리고, 안 되면 다음 무료 모델로 넘긴다 (v2 설계 20장).

TradingAgents가 만든 Gemini 모델의 `client.models`만 바꿔 끼운다. LangChain이 만든 요청(도구 호출,
구조화 출력 포함)은 그대로 두고 모델 이름만 바꿔 보내므로, 대체 모델에서도 같은 방식으로 동작한다.
한 번 넘어간 모델은 그 분석이 끝날 때까지 다시 쓰지 않는다(매 호출마다 3분씩 기다리지 않게).
"""

from collections.abc import Callable
from typing import Any

from google.genai import errors

from vater_core.api.errors import VaterError

BUDGET_SEC = 180.0  # 한 모델에서 기다리는 최대 시간
BACKOFF_SEC = (5.0, 10.0, 20.0, 40.0, 60.0)  # 구글이 대기 시간을 알려 주지 않을 때
WAIT_MESSAGE = {
    "busy": "구글 AI 서버가 혼잡합니다. 잠시 후 자동으로 다시 시도합니다.",
    "rate": "무료 사용량의 분당 한도에 걸려 잠시 기다립니다.",
}
GAVE_UP = "분석을 끝내지 못했습니다. 마친 단계는 저장됐으니 잠시 뒤 [다시 시도]를 눌러 주세요."
GAVE_UP_HINT = {
    "busy": "구글 AI 서버가 계속 혼잡했습니다.",
    "rate": "무료 사용량의 분당 한도에 계속 걸렸습니다.",
}
DAILY = "오늘 무료 사용량을 다 썼습니다. 내일 다시 시도하거나 로컬 AI로 바꿔 주세요."

OnWait = Callable[[str, str, float], None]  # (사유 busy|rate, 모델, 초)


def _details(e: errors.APIError) -> list[dict[str, Any]]:
    body = e.details if isinstance(e.details, dict) else {}
    body = body.get("error", body)
    return [d for d in body.get("details", []) if isinstance(d, dict)]


def kind_of(e: errors.APIError) -> str | None:
    """busy(혼잡) | rate(분당 한도) | daily(하루 한도) | key(키·권한) | None(그 밖: 그대로 낸다)."""
    if e.code in (500, 502, 503, 504):
        return "busy"
    if e.code == 429:
        quotas = [v.get("quotaId", "") for d in _details(e) for v in d.get("violations", [])]
        return "daily" if any("PerDay" in q for q in quotas) else "rate"
    reasons = {d.get("reason") for d in _details(e)}
    if e.code in (401, 403) or (e.code == 400 and "API_KEY_INVALID" in reasons):
        return "key"
    return None


def retry_delay(e: errors.APIError) -> float | None:
    """구글이 알려 준 대기 시간(`RetryInfo.retryDelay`, 예: "25s")."""
    for d in _details(e):
        delay = d.get("retryDelay")
        if isinstance(delay, str) and delay.endswith("s"):
            try:
                return float(delay[:-1])
            except ValueError:
                return None
    return None


def _gave_up(kinds: dict[str, str]) -> VaterError:
    rest = [k for k in kinds.values() if k != "daily"]
    if not rest:
        return VaterError("LLM_DAILY_LIMIT", DAILY, status=429)
    code = "LLM_BUSY" if rest[-1] == "busy" else "LLM_RATE_LIMITED"
    return VaterError(code, GAVE_UP, hint=GAVE_UP_HINT[rest[-1]], status=503)


class GeminiFallback:
    """`client.models` 자리에 들어간다. `generate_content` 말고는 원래 객체로 넘긴다."""

    def __init__(
        self,
        models: Any,
        chain: tuple[str, ...],
        wait: Callable[[float], None],
        on_wait: OnWait,
    ) -> None:
        self._models = models
        self._chain = chain
        self._wait = wait  # 취소되면 예외를 낸다(엔진이 넣는다)
        self._on_wait = on_wait
        self._at = 0  # 지금 쓰는 모델 위치
        self._kinds: dict[str, str] = {}  # 모델별 마지막 실패 사유
        self._failed: VaterError | None = None
        self.used: list[str] = []  # 설정한 모델 대신 답한 모델

    def __getattr__(self, name: str) -> Any:
        return getattr(self._models, name)

    def generate_content(self, *, model: str, **request: Any) -> Any:
        for i in range(self._at, len(self._chain)):
            name = self._chain[i]
            waited, tries = 0.0, 0
            while True:
                if self._failed is not None:
                    raise self._failed
                try:
                    out = self._models.generate_content(model=name, **request)
                except errors.APIError as e:
                    kind = kind_of(e)
                    if kind is None:
                        raise
                    if kind == "key":
                        raise VaterError(
                            "LLM_KEY_INVALID",
                            "Google Gemini 키가 거부되었습니다.",
                            hint="설정 > AI에서 키를 다시 입력하거나 새 키를 만드세요.",
                        ) from e
                    self._kinds[name] = kind
                    delay = retry_delay(e) or BACKOFF_SEC[min(tries, len(BACKOFF_SEC) - 1)]
                    if kind == "daily" or waited + delay > BUDGET_SEC:
                        break
                    self._on_wait(kind, name, delay)
                    self._wait(delay)
                    waited, tries = waited + delay, tries + 1
                    continue
                if i > 0 and name not in self.used:
                    self.used.append(name)
                return out
            self._at = max(self._at, i + 1)
        self._failed = self._failed or _gave_up(self._kinds)
        raise self._failed


class _Client:
    def __init__(self, client: Any, models: GeminiFallback) -> None:
        self._client = client
        self.models = models

    def __getattr__(self, name: str) -> Any:
        return getattr(self._client, name)


def install(
    llm: Any, chain: tuple[str, ...], wait: Callable[[float], None], on_wait: OnWait
) -> GeminiFallback:
    """TradingAgents의 Gemini 모델(`ChatGoogleGenerativeAI`)에 대기와 대체 모델을 붙인다."""
    fb = GeminiFallback(llm.client.models, chain, wait, on_wait)
    llm.client = _Client(llm.client, fb)
    # SDK의 짧은 재시도는 끈다: 알려 준 대기 시간을 무시하고 분당 한도만 더 쓴다.
    llm.max_retries = 1
    return fb
