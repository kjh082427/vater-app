# 검증 실험: TradingAgents + 로컬 LLM

> **버리는 실험 코드입니다.** 앱 코드가 아니며, 결론만 스펙에 반영합니다. 결과는 [`REPORT.md`](REPORT.md)에 있습니다.

## 실행 방법
```bash
cd spikes/tradingagents-local-llm
uv sync
uv run python check_env.py                  # 환경 점검
uv run python inspect_data.py 005930.KS     # 데이터 품질 (S2)
uv run python run_spike.py --ticker AAPL --preset local-4b   # 분석 실행 (S1, S3, S4, S6)
```
- 클라우드 키는 저장소 루트의 `.env`에서 읽습니다(`LLM_GOOGLE_KEY` 등). 키 값은 출력하지 않습니다.
- 원시 결과는 `runs/`에 저장되고 git에서 제외됩니다.

## 환경 (2026-11-03 확인)
| 항목 | 값 |
|---|---|
| Ollama | 0.40.13 (Windows, WSL에서 `localhost:11434` 접속, mirrored 네트워크) |
| 모델 | `qwen3.5:4b` (3.32GB), `qwen3.5:9b` (6.55GB) |
| TradingAgents | v0.7.1 (`git+https://github.com/TauricResearch/TradingAgents@v0.7.1`) |
| Python / uv | 3.13 / 0.13.6 |
| GPU | RTX 3080 Laptop 8GB |

## `DEFAULT_CONFIG`의 실제 키 이름 (`check_env.py` 출력)
| 용도 | 키 | 기본값 |
|---|---|---|
| 기본 제공자 | `llm_provider` | `"openai"` |
| 등급별 모델 | `deep_think_llm`, `quick_think_llm` | `"gpt-6-sol"`, `"gpt-6-luna"` |
| 등급별 제공자 | `deep_think_provider`, `quick_think_provider` | `null` (= `llm_provider`) |
| 백엔드 URL | `backend_url`, `deep_think_backend_url`, `quick_think_backend_url` | `null` |
| 체크포인트 | `checkpoint_enabled` | `false` |
| 토론 라운드 | `max_debate_rounds`, `max_risk_discuss_rounds` | `1`, `1` |
| **출력 언어** | **`output_language`** | **`"English"`** → S3: 설정으로 지원 |
| 도구 호출 한도 | `max_tool_rounds` | `20` |
| 데이터 출처 | `data_vendors` | 가격·지표·뉴스 `yfinance`, 재무 `sec_edgar,yfinance`, 거시 `fred`, 예측시장 `polymarket` |
| 시장별 기준 지수 | `benchmark_map` | `.KS → ^KS11`, `.KQ → ^KQ11` 포함 (국내 종목 인식) |
| Gemini 추론 수준 | `google_thinking_level` | `null` |
| 메모리 로그 | `memory_log_path` | `~/.tradingagents/memory/trading_memory.md` |

- `num_ctx`(Ollama 컨텍스트 길이)를 넘기는 설정은 없습니다. 그래서 Ollama `/api/create`로 `num_ctx 16384`를 고정한 모델 변형(`*-16k`)을 만들어 씁니다(Task 3).
