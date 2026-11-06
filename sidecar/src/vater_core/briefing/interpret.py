"""브리핑 해석: deep 모델을 1번 부른다 (스펙 6장). TradingAgents는 이 파일에서만 import한다.

- Google이면 분석과 같은 대기와 대체 모델을 쓴다(`analysis/fallback.py`, v2 설계 20장). 로컬과 다른
  공급자는 그대로다.

- **숫자 환각 차단:** 숫자는 화면이 수집 데이터로 직접 그린다. 프롬프트에서 숫자를 쓰지 말라고 하고,
  그래도 숫자가 든 문장은 저장하기 전에 뺀다.
- 키는 환경변수가 아니라 LLM 클라이언트 인자로만 넘긴다. 분석이 같은 때 환경변수를 넣고
  되돌리므로, 브리핑이 환경변수를 건드리면 서로 꼬인다.
- 호출 오류의 원문(키가 섞일 수 있음)은 마스킹되는 로그에만 남긴다.
"""

import json
import logging
import re
import time
from collections.abc import Callable
from typing import Any, Protocol

from vater_core.analysis.fallback import GAVE_UP_HINT, install
from vater_core.api.errors import VaterError
from vater_core.llm.presets import ENV_FOR_PROVIDER, LlmRun

logger = logging.getLogger(__name__)

SECTIONS = ("headline", "market", "sectors", "flows", "notable", "watchlist")

SYSTEM = """너는 한국 개인 투자자를 위한 일일 시장 브리핑을 쓴다.
규칙:
- 사용자가 준 JSON 데이터만 근거로 쓴다. 데이터에 없는 사실은 지어내지 않는다.
- 숫자를 쓰지 않는다. 지수, 등락률, 금액, 순위, 날짜 같은 숫자는 화면이 표와 차트로 따로 보여준다.
  "크게 올랐다", "소폭 내렸다", "순매수했다"처럼 말로 표현한다.
- 한국어로, 항목마다 한두 문장으로 쓴다. 데이터가 없는 항목은 빈 문자열("")로 둔다.
- 매수·매도를 권하지 않는다.
- 다른 말 없이 JSON 객체 하나만 출력한다. 키는 다음 여섯 개다.
  headline: 오늘 시장 한 줄 요약
  market: 주요 지수의 흐름
  sectors: 업종별 강약과 상승·하락 종목 수
  flows: 외국인·기관·개인 수급
  notable: 눈에 띄는 상승·하락·거래대금 상위 종목
  watchlist: 내 감시 종목의 흐름과 오늘 울린 알림"""

_KIND = {"LLM_BUSY": "busy", "LLM_RATE_LIMITED": "rate"}
_SENTENCE = re.compile(r"(?<=[.!?。])\s+|\n+")
_DIGIT = re.compile(r"\d")
_FENCE = re.compile(r"```(?:json)?", re.IGNORECASE)


class ChatModel(Protocol):
    def invoke(self, messages: list[tuple[str, str]]) -> Any: ...


def _failed(message: str) -> VaterError:
    return VaterError(
        "BRIEFING_LLM_FAILED",
        message,
        "데이터만으로 브리핑을 저장했습니다. 설정 > AI에서 프리셋이나 키를 확인하세요.",
        status=502,
    )


def build_messages(market: str, data: dict[str, Any]) -> list[tuple[str, str]]:
    label = "국내" if market == "KR" else "미국"
    payload = json.dumps(data, ensure_ascii=False)
    return [
        ("system", SYSTEM),
        ("human", f"{label} 시장 {data.get('session', '')} 세션 데이터:\n{payload}"),
    ]


def _without_numbers(text: str) -> str:
    kept = [s.strip() for s in _SENTENCE.split(text) if s.strip() and not _DIGIT.search(s)]
    return " ".join(kept)


def parse_text(raw: str) -> dict[str, str]:
    """모델 출력에서 첫 JSON 객체를 읽어 항목 6개 문장으로. 숫자가 든 문장은 뺀다."""
    text = _FENCE.sub("", raw)
    start = text.find("{")
    if start < 0:
        raise _failed("AI 해석 결과에 JSON이 없습니다.")
    try:
        obj, _ = json.JSONDecoder().raw_decode(text[start:])
    except ValueError as e:
        raise _failed("AI 해석 결과를 읽을 수 없습니다.") from e
    if not isinstance(obj, dict):
        raise _failed("AI 해석 결과 형식이 다릅니다.")
    out: dict[str, str] = {}
    for key in SECTIONS:
        value = obj.get(key) or ""  # 해당 없는 항목을 null로 주는 모델도 있다
        if not isinstance(value, str):
            raise _failed(f"AI 해석 결과의 '{key}'가 문장이 아닙니다.")
        out[key] = _without_numbers(value)
    return out


def _content(reply: Any) -> str:
    content = getattr(reply, "content", reply)
    if isinstance(content, str):
        return content
    if isinstance(content, list):  # Gemini 등: [{"type": "text", "text": ...}, ...]
        parts = [b.get("text", "") if isinstance(b, dict) else str(b) for b in content]
        return "".join(parts)
    return str(content)


def _key_kwargs(run: LlmRun) -> dict[str, str]:
    provider = run.deep.provider
    name = ENV_FOR_PROVIDER.get(provider)
    if provider == "ollama" or name is None or name not in run.env:
        return {}
    return {"api_key": run.env[name]}


def deep_model(run: LlmRun) -> ChatModel:
    from tradingagents.default_config import DEFAULT_CONFIG
    from tradingagents.llm_clients.factory import build_llm_kwargs, create_tier_client

    config: dict[str, Any] = {**DEFAULT_CONFIG, **run.overrides}
    keys = _key_kwargs(run)
    if run.deep.provider == "openai" and not config.get("backend_url"):
        # TradingAgents의 OpenAI 클라이언트는 키를 인자로 줘도 환경변수부터 확인하고 실패한다.
        # 같은 모델 클래스를 직접 만들어 키를 인자로만 넘긴다(공식 OpenAI는 Responses API).
        from tradingagents.llm_clients.openai_client import NormalizedChatOpenAI

        options = build_llm_kwargs({**config, "llm_provider": "openai"})
        openai: ChatModel = NormalizedChatOpenAI(
            model=config["deep_think_llm"], use_responses_api=True, **options, **keys
        )
        return openai
    llm: ChatModel = create_tier_client(config, "deep", **keys).get_llm()
    chain = run.chains.get("deep")
    if run.deep.provider == "google" and chain:
        install(llm, chain, time.sleep, _log_wait)
    return llm


def _log_wait(reason: str, model: str, seconds: float) -> None:
    logger.info("briefing AI waits %.0fs (%s, %s)", seconds, reason, model)


def interpret(
    market: str,
    data: dict[str, Any],
    run: LlmRun,
    factory: Callable[[LlmRun], ChatModel] = deep_model,
) -> dict[str, str]:
    """동기 함수다. 서비스가 `asyncio.to_thread`로 부른다."""
    try:
        reply = factory(run).invoke(build_messages(market, data))
    except VaterError as e:  # 대기와 대체 모델을 다 쓴 결과: 혼잡, 분당·하루 한도, 키 오류
        logger.warning("briefing interpretation failed (%s)", e.code)
        if e.code in _KIND:  # 분석 화면 문구("마친 단계는 저장됐으니")는 브리핑에 맞지 않는다
            message = f"{GAVE_UP_HINT[_KIND[e.code]]} 해석 없이 저장했습니다."
            raise VaterError(e.code, message, status=e.status) from e
        raise
    except Exception as e:
        logger.exception("briefing interpretation failed")
        raise _failed(f"AI 해석에 실패했습니다 ({type(e).__name__}).") from e
    return parse_text(_content(reply))
