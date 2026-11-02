# core/analysis 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TradingAgents로 종목 하나를 분석하는 작업 큐, 진행 스트리밍, 결과 저장, API를 만든다. 국내 종목은 한투 데이터 공급자 `kis`를 쓴다.

**Architecture:**
- `sidecar/src/vater_core/analysis/` 아래에 둔다.
  - `engine.py`: `AnalysisEngine` 경계. TradingAgents는 이 파일과 `kis_vendor.py`에서만 import한다(스펙 5장). 테스트에서는 가짜 엔진을 끼운다.
  - `kis_vendor.py`: TradingAgents의 `VENDOR_METHODS`에 `kis` 공급자를 등록한다. 워커 스레드에서 부르므로, 이벤트 루프의 비동기 한투 클라이언트를 `run_coroutine_threadsafe`로 부른다.
  - `store.py`: `analyses` 테이블 읽기·쓰기. **쓰기는 이벤트 루프 스레드에서만** 한다(foundation 리뷰 규칙).
  - `queue.py`: 한 번에 1건씩 처리하는 작업 큐. 엔진은 `asyncio.to_thread`로 돌리고, 진행 이벤트는 스레드에서 `EventBus.publish`(스레드 안전)로 보낸다.
  - `summary.py`: 최종 결정문에서 등급, 3줄 요약, 목표가, 기간을 뽑는다(LLM을 한 번 더 부르지 않는다).
- 라우트 `api/routes/analyses.py`.

**Tech Stack:** TradingAgents 0.7.1(새 의존성), 기존 `llm/presets.build_run`, `llm/ollama`, `kis/quotes`, `kis/fundamentals`, `EventBus`, `stdout_events.notify`

**Spec:** `docs/superpowers/specs/2026-11-02-vater-mvp-design.md` 5장(분석), 2-3(API), 2-5(종목 식별), 8장(오류). 근거: `spikes/tradingagents-local-llm/REPORT.md`(S2~S6, S8), `spikes/tradingagents-local-llm/run_spike.py`(동작 확인된 실행 방식).

## Global Constraints
- 브랜치 `core/analysis`, 폴더 `sidecar/src/vater_core/analysis/`, `api/routes/analyses.py`. 라벨 `area:core`.
- 의존성: `tradingagents==0.7.1`(검증 실험과 같은 버전). `uv.lock` 갱신.
- **주문 API 없음** (`tests/test_readonly_guarantee.py` 통과 유지).
- 기본 옵션(스펙 5장): 토론 라운드 = `analysis.debate_rounds`, `output_language` = `llm.output_language`, `checkpoint_enabled=True`, `llm_max_retries=2`(스펙 8장 "2회 재시도").
- 애널리스트: 국내(`KR`) `("market", "news", "fundamentals")`, 미국 `("market", "social", "news", "fundamentals")`.
- 종목 → TradingAgents 티커(스펙 2-5): `KR` + `KOSPI` → `<code>.KS`, `KR` + `KOSDAQ` → `<code>.KQ`, `US` → 코드 그대로. 거래소는 `symbols` 테이블에서 찾는다. 없으면 `SYMBOL_UNKNOWN`(404).
- 국내 종목의 `tool_vendors`: `get_stock_data`, `get_indicators`, `get_fundamentals`, `get_balance_sheet`, `get_income_statement`, `get_cashflow`, `get_news`, `get_insider_transactions` → `"kis"`. 미국은 TradingAgents 기본값.
- 경로: `data_dir/cache/tradingagents/{logs,cache,memory/trading_memory.md}` → `results_dir`, `data_cache_dir`, `memory_log_path`. 체크포인트는 `data_cache_dir/checkpoints/<티커>.db`(S5).
- **API 키는 환경변수로만** (`LlmRun.env`). 분석 실행 동안만 `os.environ`에 넣고 끝나면 원래 값으로 되돌린다. 한 번에 1건만 돌기 때문에 겹치지 않는다. **`overrides`(compat 주소 포함)는 DB에 저장하지 않는다.** DB의 `models`에는 `LlmRun.deep/quick`의 provider·model만 저장한다.
- 상태: `queued → running → done | failed | cancelled`. 사이드카가 다시 시작되면 `queued`·`running`으로 남은 행은 `failed`(`ANALYSIS_INTERRUPTED`)로 바꾼다. [다시 시도]하면 체크포인트로 이어진다.
- 진행 이벤트(SSE): `analysis.progress` `{id, stage, node, elapsed_sec}`, `analysis.status` `{id, status, decision?, error?}`. 완료·실패 시 stdout `notify`(제목 "분석 완료"/"분석 실패", 본문 "<종목명> — <한국어 결정>", route `/analyses/<id>`).
- 단계 이름(`stage`): `analysts`(4명, namespace로 구분) → `research`(Bull/Bear Researcher, Research Manager) → `trader` → `risk`(Aggressive/Conservative/Neutral Analyst) → `portfolio`(Portfolio Manager). 그 밖의 노드는 `other`.
- 결정값(S4): `Buy|Overweight|Hold|Underweight|Sell|REVIEW`. 한국어 표기 `매수|비중확대|보유|비중축소|매도|검토 필요`.
- 한투 호출 우선순위: `Priority.BRIEFING`(알림 감시보다 낮게).
- 오류 코드(새로): `ANALYSIS_NOT_FOUND` 404, `ANALYSIS_NOT_CANCELLABLE` 409, `ANALYSIS_INTERRUPTED`, `ANALYSIS_FAILED`, `ANALYSIS_CANCELLED`, `SYMBOL_UNKNOWN` 404. 시작 전 확인 실패는 `build_run`·`require_model`의 코드(`LLM_KEY_MISSING` 등)를 그대로 쓴다.

## Review Focus
1. **분석 도중 사이드카가 꺼짐** → 다음 시작 때 그 행이 `running`으로 남지 않고 `failed`/`ANALYSIS_INTERRUPTED`가 되며, [다시 시도]가 같은 종목·기준일·프리셋으로 새 작업을 만든다. (Task 3, 6)
2. **실행 중 취소** → 다음 노드 경계에서 멈추고 `cancelled`. 대기 중 취소는 바로 `cancelled`. 끝난 작업 취소는 409. (Task 4, 5)
3. **엔진 예외(LLM 실패, 데이터 오류)** → 행은 `failed`, `error`에 `{code, message, hint}`. 예외 메시지에 키가 섞여 있으면 마스킹 로그만 남기고 DB·SSE에는 원문을 넣지 않는다. 큐는 다음 작업을 계속 처리한다. (Task 4, 5)
4. **한투 키가 없는데 국내 종목 분석** → 시작 전에 `KIS_NOT_CONFIGURED`(409). 한투 조회가 실패하면 공급자가 TradingAgents의 `VendorUnavailableError`를 내서 "데이터 없음"으로 처리되고 분석은 계속된다. (Task 2, 5)
5. **분석 중 환경변수 누수** → 끝나면(성공·실패·취소 모두) `os.environ`의 LLM 키가 원래대로 돌아간다. (Task 4)

---

### Task 1: 의존성, 종목→티커, 결정문 요약

**Files:**
- Modify: `sidecar/pyproject.toml`, `sidecar/uv.lock`
- Create: `sidecar/src/vater_core/analysis/__init__.py`, `analysis/symbols.py`, `analysis/summary.py`
- Test: `sidecar/tests/analysis/test_symbols.py`, `tests/analysis/test_summary.py`

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True) Target(market: Literal["KR","US"], code: str, exchange: str, name: str, ticker: str)` + `domestic: bool`
  - `resolve_target(conn, market, code) -> Target` (`symbols` 테이블. 없으면 `SYMBOL_UNKNOWN` 404)
  - `analysts_for(target) -> tuple[str, ...]`
  - `Decision = Literal["Buy","Overweight","Hold","Underweight","Sell","REVIEW"]`, `DECISION_KO: dict[Decision, str]`
  - `@dataclass(frozen=True) DecisionSummary(decision: Decision, lines: tuple[str, ...], price_target: str | None, time_horizon: str | None)`
  - `summarize(final_trade_decision: str) -> DecisionSummary` (`**Rating**:`, `**Executive Summary**:`, `**Price Target**:`, `**Time Horizon**:` 항목. 요약은 Executive Summary를 문장 단위로 최대 3줄. 항목이 없으면 Investment Thesis, 그것도 없으면 본문 앞부분. `not provided`는 `None`)
- [ ] **Step 1: 실패하는 테스트**
  - `test_kospi_kosdaq_us_tickers`: `005930`(KOSPI) → `005930.KS`, `247540`(KOSDAQ) → `247540.KQ`, `AAPL`(NAS) → `AAPL`
  - `test_unknown_symbol`: → `SYMBOL_UNKNOWN`, 404
  - `test_analysts_for`: 국내는 social 없음
  - `test_summarize_cloud_sample`: 검증 실험 실제 결정문(`tests/analysis/fixtures/final_decision_cloud.md`, AAPL 클라우드 실행에서 복사) → `Hold`, 3줄, `price_target is None`, `time_horizon == "3-6 months"`
  - `test_summarize_without_rating_is_review`, `test_summarize_without_sections_uses_text`
- [ ] **Step 2: 실패 확인** — `uv run pytest tests/analysis -q` / Expected: FAIL (import 오류)
- [ ] **Step 3: 구현.** `pyproject.toml`에 `tradingagents==0.7.1` 추가 후 `uv lock && uv sync`. 등급 추출은 TradingAgents `parse_rating`을 쓰지 않고 같은 규칙을 직접 구현한다(`summary.py`가 TradingAgents를 import하지 않게)
- [ ] **Step 4: 통과 확인** — `uv run pytest -q` / Expected: PASS (`test_readonly_guarantee` 포함)
- [ ] **Step 5: 커밋** — `feat(analysis): 종목→티커 변환과 결정문 요약`

### Task 2: 한투 데이터 공급자 `kis`

**Files:**
- Create: `sidecar/src/vater_core/analysis/kis_vendor.py`
- Test: `sidecar/tests/analysis/test_kis_vendor.py`

**Interfaces:**
- Consumes: `kis.quotes.domestic_daily`, `kis.fundamentals.financials/news_titles/as_markdown`, `KisClient`
- Produces:
  - `KIS_TOOLS: tuple[str, ...]` (Global Constraints의 8개 메서드)
  - `class KisBridge(client: KisClient, loop: asyncio.AbstractEventLoop, timeout: float = 30.0)` + `call(coro) -> T` (워커 스레드에서 루프의 코루틴을 실행해 결과를 기다림)
  - `install_kis_vendor() -> None` (TradingAgents `router.VENDOR_METHODS[m]["kis"]`에 아래 함수 등록. 여러 번 불러도 같음)
  - `kis_session(bridge) -> ContextManager[None]` (실행 동안만 모듈 전역 브리지를 설정. 겹치면 `RuntimeError`)
  - 공급자 함수(TradingAgents 시그니처와 같게):
    - `get_stock_data(symbol, start_date, end_date) -> str`: 한투 일봉을 yfinance와 같은 CSV(`Date,Open,High,Low,Close,Volume`)와 머리말 `# Stock data for <symbol> from ... to ...`로
    - `get_indicators(symbol, indicator, as_of_date, look_back_days) -> str`: 한투 일봉(기준일 전 400일)으로 `stockstats` 지표를 계산해 날짜별 값. 지원하지 않는 지표는 `ValueError`(TradingAgents가 도구 오류로 처리)
    - `get_fundamentals(ticker, as_of_date=None)`: 재무비율 연간 표(markdown)
    - `get_balance_sheet` / `get_income_statement(ticker, freq="quarterly", as_of_date=None)`: 해당 표(`freq`가 `annual`이면 year)
    - `get_cashflow(...)`, `get_insider_transactions(...)`: 한투에 없음 → `NoMarketDataError`
    - `get_news(ticker, start_date, end_date)`: 기간 안의 뉴스 제목 목록(markdown). 없으면 `NoMarketDataError`
  - 한투 호출 실패(`KisApiError`, `VaterError`, 시간 초과)는 `VendorUnavailableError`로 바꾼다(라우터가 "데이터 없음"으로 처리, 분석은 계속)
  - 티커의 `.KS`/`.KQ`를 떼고 6자리 코드로 조회한다
- [ ] **Step 1: 실패하는 테스트** (respx + `tests/kis/fixtures`의 실제 응답, 별도 스레드에서 호출해 브리지 확인)
  - `test_stock_data_csv`, `test_indicator_rsi_values`(값이 0~100, 날짜 내림차순 `look_back_days`개), `test_financial_markdown`, `test_news_markdown_filters_dates`
  - `test_cashflow_is_no_data`, `test_kis_error_becomes_vendor_unavailable`
  - `test_route_to_vendor_uses_kis`: `install_kis_vendor()` 후 `tool_vendors={"get_stock_data": "kis"}` 설정으로 TradingAgents `route_to_vendor("get_stock_data", ...)`가 이 함수를 부른다
  - `test_session_must_not_overlap`
- [ ] **Step 2~4:** 실패 확인 → 구현 → `uv run pytest -q` 통과
- [ ] **Step 5: 커밋** — `feat(analysis): 국내 종목용 한투 데이터 공급자`

### Task 3: 분석 저장소

**Files:**
- Create: `sidecar/src/vater_core/analysis/store.py`
- Test: `sidecar/tests/analysis/test_store.py`

**Interfaces:**
- Produces:
  - `@dataclass Analysis(id, market, code, as_of: str, preset, status, models: dict | None, decision, summary: list[str] | None, reports: dict[str,str] | None, timings: dict[str,float] | None, tokens: dict[str,int] | None, error: dict | None, created_at: str)`
  - `class AnalysisRepo(conn)`: `create(target, as_of, preset) -> int`, `get(id) -> Analysis`(없으면 `ANALYSIS_NOT_FOUND`), `list(market=None, code=None, limit=50) -> list[Analysis]`(최신순), `set_running(id, models)`, `finish(id, result: EngineResult)`, `fail(id, code, message, hint)`, `cancel(id)`, `previous_done(market, code, before_id) -> Analysis | None`, `recover_interrupted() -> int`
  - 기존 `001_init.sql`의 `analyses` 열을 그대로 쓴다(마이그레이션 없음). JSON 열은 `json.dumps(ensure_ascii=False)`
- [ ] **Step 1: 실패하는 테스트**: 생성→실행→완료 흐름, 실패의 `error` JSON, 목록 최신순과 종목 필터, `previous_done`이 직전 완료만 고름, `recover_interrupted`가 queued·running을 `failed`/`ANALYSIS_INTERRUPTED`로 바꾸고 개수를 돌려줌
- [ ] **Step 2~4:** 실패 확인 → 구현 → 통과
- [ ] **Step 5: 커밋** — `feat(analysis): 분석 결과 저장소`

### Task 4: 엔진 경계와 TradingAgents 엔진

**Files:**
- Create: `sidecar/src/vater_core/analysis/engine.py`
- Test: `sidecar/tests/analysis/test_engine.py`

**Interfaces:**
- Consumes: `LlmRun`, `Target`, `summarize`, `kis_session`, `install_kis_vendor`
- Produces:
  - `@dataclass(frozen=True) EngineJob(id: int, target: Target, as_of: date, run: LlmRun, paths: TaPaths)`, `TaPaths(results_dir, data_cache_dir, memory_log_path)` + `TaPaths.under(data_dir)`
  - `@dataclass(frozen=True) Progress(stage: str, node: str, elapsed_sec: float)`
  - `@dataclass(frozen=True) EngineResult(summary: DecisionSummary, reports: dict[str, str], timings: dict[str, float], tokens: dict[str, int])`
  - `class Cancelled(Exception)`
  - `class AnalysisEngine(Protocol)`: `def run(self, job: EngineJob, on_progress: Callable[[Progress], None], cancel: threading.Event, kis: KisBridge | None) -> EngineResult` (동기. 워커 스레드에서 부른다)
  - `stage_of(node: str, namespace: str) -> str` (Global Constraints의 단계 표)
  - `build_config(job) -> dict[str, Any]` (`DEFAULT_CONFIG` 복사 + `job.run.overrides` + 경로 + `checkpoint_enabled=True` + `llm_max_retries=2` + 국내면 `tool_vendors`)
  - `scoped_env(env: Mapping[str, str]) -> ContextManager[None]` (들어갈 때 설정, 나올 때 원래 값 복원·없던 키 삭제)
  - `class TradingAgentsEngine(AnalysisEngine)`: `run_spike.py`의 실행 방식 그대로(`checkpoint_scope`, `checkpoint_input`, `graph.stream(subgraphs=True, stream_mode=["updates","values"])`, `run_config_context`). 노드 이벤트마다 `cancel.is_set()`이면 `Cancelled`. 끝나면 `clear_checkpoint_on_success`. 토큰은 LangChain 콜백(`usage_metadata`)으로 센다. 단계별 시간은 단계의 첫 이벤트~마지막 이벤트
- [ ] **Step 1: 실패하는 테스트** (TradingAgents의 LLM은 부르지 않는다)
  - `test_stage_of`: 실험에서 본 노드 이름 전부
  - `test_build_config_domestic_uses_kis`, `test_build_config_us_keeps_defaults`, `test_build_config_has_no_secrets`(env 값이 config 어디에도 없음)
  - `test_scoped_env_restores_on_error`: 기존 값이 있던 키·없던 키 모두 예외 후 원래대로
  - `test_engine_cancels_between_nodes`: TradingAgents 그래프 대신 가짜 스트림을 주입할 수 있게 `TradingAgentsEngine(graph_factory=...)`로 만들고, 두 번째 이벤트에서 `cancel.set()` → `Cancelled`, 그 뒤 이벤트는 처리하지 않음
  - `test_engine_result_from_final_state`: 가짜 스트림의 마지막 `values`에서 보고서 7개와 요약
- [ ] **Step 2~4:** 실패 확인 → 구현 → 통과
- [ ] **Step 5: 커밋** — `feat(analysis): 분석 엔진 경계와 TradingAgents 실행`

### Task 5: 작업 큐

**Files:**
- Create: `sidecar/src/vater_core/analysis/queue.py`
- Modify: `sidecar/src/vater_core/api/deps.py`(`analysis: AnalysisQueue | None`, TYPE_CHECKING)
- Test: `sidecar/tests/analysis/test_queue.py`

**Interfaces:**
- Consumes: Task 1~4, `build_run`, `get_llm(deps).ollama`, `require_kis`, `EventBus`, `notify`
- Produces:
  - `class AnalysisQueue(deps: AppDeps, engine: AnalysisEngine)`: `async submit(market, code, as_of: date | None, preset: Preset | None) -> int`, `async cancel(id) -> None`, `async retry(id) -> int`, `start() -> None`, `async stop() -> None`, `running_id: int | None`
  - `submit`는 시작 전 확인을 **바로** 한다(키·로컬 모델·한투 키·종목). 실패하면 행을 만들지 않고 오류를 그대로 낸다. 로컬 단계가 있으면 `ollama.start()`로 자동 실행을 시도한 뒤 `require_model`
  - `as_of`가 없으면 최근 거래일: 국내는 오늘(KST)부터 거꾸로 `is_domestic_trading_day`, 미국은 `America/New_York` 기준 직전 평일
  - 워커는 하나. 엔진은 `asyncio.to_thread`로 돌리고 `on_progress`는 `events.publish("analysis.progress", ...)`(스레드 안전)
  - 예외 처리: `Cancelled` → `cancel`, `VaterError` → 그 코드로 `fail`, 그 밖 → `ANALYSIS_FAILED`(메시지는 예외 종류만, 원문은 마스킹 로그)
  - `get_deps`와 같은 방식의 `get_analysis(deps) -> AnalysisQueue`
- [ ] **Step 1: 실패하는 테스트** (가짜 엔진: 진행 이벤트 2개를 내고 결과를 돌려주거나, `cancel`을 기다리거나, 예외를 냄)
  - `test_submit_runs_and_saves_result`: `analysis.status` running → done, DB `done`, 결정·요약 저장, `notify`가 stdout으로 나감(캡처)
  - `test_jobs_run_one_at_a_time`: 2건 제출 → 두 번째는 첫 번째가 끝난 뒤 시작
  - `test_cancel_queued_and_running`: 대기 중은 바로 `cancelled`, 실행 중은 엔진이 `Cancelled`를 내고 `cancelled`. 끝난 작업 취소는 `ANALYSIS_NOT_CANCELLABLE` 409
  - `test_engine_error_marks_failed_and_continues`: 첫 작업 예외(메시지에 가짜 키 포함) → `failed`, DB·이벤트에 키 없음, 다음 작업은 정상 처리
  - `test_submit_checks_before_queueing`: 키 없음 → `LLM_KEY_MISSING`, 행 0개. 국내 종목인데 한투 키 없음 → `KIS_NOT_CONFIGURED`
  - `test_retry_copies_parameters`: 실패한 작업 retry → 같은 종목·기준일·프리셋의 새 행
  - `test_env_is_scoped_to_run`: 실행 중에는 `GOOGLE_API_KEY`가 있고 끝나면 없다
- [ ] **Step 2~4:** 실패 확인 → 구현 → 통과
- [ ] **Step 5: 커밋** — `feat(analysis): 한 번에 1건씩 처리하는 분석 작업 큐`

### Task 6: API와 시작 연결

**Files:**
- Create: `sidecar/src/vater_core/api/routes/analyses.py`
- Modify: `api/app.py`, `__main__.py`(시작 때 `recover_interrupted`, 큐 시작, 종료 때 `stop`), `tests/snapshots/openapi.json`
- Test: `sidecar/tests/api/test_analyses_api.py`

**Interfaces:**

| 메서드·경로 | 요청 | 응답 |
|---|---|---|
| `POST /analyses` | `{market, code, as_of?, preset?}` | 202 `{id, status: "queued"}` |
| `GET /analyses?market=&code=&limit=` | | `[{id, market, code, name, as_of, preset, status, decision, decision_ko, decision_changed, created_at}]` |
| `GET /analyses/{id}` | | 위 항목 + `models, summary, price_target, time_horizon, reports, timings, tokens, error` |
| `POST /analyses/{id}/cancel` | | `{id, status}` |
| `POST /analyses/{id}/retry` | | 202 `{id, status: "queued"}` (새 id) |

  - `decision_changed`: 같은 종목의 직전 완료 분석과 결정이 다르면 true(스펙 5장 "이력")
- [ ] **Step 1: 실패하는 테스트**: 각 엔드포인트의 정상·오류 경로, 토큰 없이 401, `test_entrypoint`에서 `VATER_BACKGROUND_JOBS=0`일 때도 `recover_interrupted`는 실행됨
- [ ] **Step 2~4:** 실패 확인 → 구현 → 통과. OpenAPI 스냅샷은 추가 경로만 바뀌었는지 의미 비교로 확인
- [ ] **Step 5: 커밋** — `feat(analysis): 분석 API`

### Task 7: 실연동 확인과 README

**Files:**
- Create: `sidecar/tests/analysis_live/test_analysis_live.py` (`@pytest.mark.llm`)
- Modify: `sidecar/README.md`

- [ ] **Step 1: 실연동 테스트**: 클라우드 프리셋(Gemini, 루트 `.env` 읽기만) + 실제 한투로 `005930`(국내, `kis` 공급자)과 `AAPL` 각 1건을 큐로 끝까지 실행. 확인: `done`, 결정이 6개 값 중 하나, 국내 보고서에 한투 재무 숫자(억원)가 들어 있고 "NO_DATA_AVAILABLE"이 재무·뉴스에 없다. 키가 없으면 skip
- [ ] **Step 2: 실행** — `uv run pytest -m llm tests/analysis_live -q -s` (약 20분)
- [ ] **Step 3: README**, 전체 검사(`ruff`, `ruff format --check`, `mypy src tests`, `pytest -q`)
- [ ] **Step 4: 커밋** — `test(analysis): 실연동 분석과 README`
