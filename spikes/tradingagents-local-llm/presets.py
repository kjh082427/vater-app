# SPIKE: throwaway code, not part of the app
"""프리셋 → TradingAgents 설정. 키는 저장소 루트 .env(LLM_*)에서 읽어 제공자 환경변수로 옮긴다."""

import copy
import os
from pathlib import Path

from dotenv import dotenv_values
from tradingagents.default_config import DEFAULT_CONFIG

HERE = Path(__file__).resolve().parent
RUNS = HERE / "runs"
OLLAMA_V1 = "http://localhost:11434/v1"
LOCAL_MODELS = {"local-4b": "qwen3.5:4b-16k", "local-9b": "qwen3.5:9b-16k"}
GEMINI_DEEP = "gemini-3.8-flash"
GEMINI_QUICK = "gemini-3.5-flash-lite"
ENV_MAP = {"LLM_GOOGLE_KEY": "GOOGLE_API_KEY", "LLM_ANTHROPIC_KEY": "ANTHROPIC_API_KEY", "LLM_OPENAI_KEY": "OPENAI_API_KEY"}
PRESETS = ("local-4b", "local-9b", "mixed", "cloud")


def load_keys() -> list[str]:
    """루트 .env를 찾아 비어 있지 않은 LLM 키만 환경변수로 옮기고, 옮긴 제공자 변수 이름을 돌려준다."""
    for d in (HERE, *HERE.parents):
        env = d / ".env"
        if env.exists():
            loaded = []
            for src, dst in ENV_MAP.items():
                value = (dotenv_values(env).get(src) or "").strip()
                if value:
                    os.environ[dst] = value
                    loaded.append(dst)
            return loaded
    return []


def build_config(preset: str, output_language: str = "Korean", checkpoint: bool = False) -> dict:
    if preset not in PRESETS:
        raise ValueError(f"unknown preset {preset!r}; choose from {PRESETS}")
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    home = RUNS / "ta-home"
    cfg.update(
        max_debate_rounds=1,
        max_risk_discuss_rounds=1,
        output_language=output_language,
        checkpoint_enabled=checkpoint,
        results_dir=str(home / "logs"),
        data_cache_dir=str(home / "cache"),
        memory_log_path=str(home / "memory" / "trading_memory.md"),
    )
    if preset in LOCAL_MODELS:
        model = LOCAL_MODELS[preset]
        cfg.update(llm_provider="ollama", backend_url=OLLAMA_V1, deep_think_llm=model, quick_think_llm=model)
    elif preset == "mixed":
        cfg.update(
            llm_provider="ollama",
            quick_think_provider="ollama", quick_think_backend_url=OLLAMA_V1, quick_think_llm=LOCAL_MODELS["local-4b"],
            deep_think_provider="google", deep_think_llm=GEMINI_DEEP,
        )
    else:  # cloud
        cfg.update(llm_provider="google", deep_think_llm=GEMINI_DEEP, quick_think_llm=GEMINI_QUICK)
    return cfg


def default_analysts(ticker: str) -> tuple[str, ...]:
    """국내 종목은 소셜 애널리스트를 끈다(S2, 스펙 5장)."""
    if ticker.upper().endswith((".KS", ".KQ")):
        return ("market", "news", "fundamentals")
    return ("market", "social", "news", "fundamentals")
