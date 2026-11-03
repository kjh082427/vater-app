# core/briefing 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 거래일마다 국내(16:00 KST)·미국(07:00 KST) 일일 시장 브리핑을 자동으로 만든다. 숫자는 한투 데이터 그대로 저장하고, LLM은 해석 문장만 1번 호출로 쓴다.

**Architecture:**
- `sidecar/src/vater_core/briefing/` 아래:
  - `schedule.py`: 지금 만들어야 할 브리핑의 세션 날짜 `due_session()` (설정 시각, 마감 + 10분, 휴장일, 놓친 브리핑)
  - `collect.py`: 한투 데이터 수집. 항목마다 따로 받고, 실패한 항목은 `missing`에 남긴다
  - `interpret.py`: LLM 1회 호출 경계(TradingAgents의 LLM 생성 함수만 쓴다). 프롬프트, JSON 해석, 숫자 문장 제거
  - `store.py`: `briefings` 테이블(이미 `001_init.sql`에 있음)
  - `service.py`: 만들기(수집 → 해석 → 저장 → 알림), 1분마다 일정 확인, 한 번에 1건
- 라우트 `api/routes/briefings.py`. DB 쓰기는 모두 이벤트 루프에서 한다(LLM 호출만 `asyncio.to_thread`).

**Tech Stack:** 기존 `kis/market.py`·`kis/quotes.py`, `alerts/clock.py`(`MarketClock.is_session_day`, `KST`, `KR_CLOSE`, `SETTLE`), `exchange_calendars`(XNYS 개장·폐장 시각), `llm/presets.build_run`, TradingAgents `llm_clients.factory.create_tier_client`, `EventBus`, `notify`, `alerts/store.EventRepo`

**Spec:** `docs/superpowers/specs/2026-11-02-vater-mvp-design.md` 6장(브리핑), 2-3(API), 2-4(`briefings` 테이블), 4-1(이벤트 알림 "일일 브리핑 도착"), 10장(브리핑 테스트: 일정, 놓친 브리핑, 부분 실패, 출력 스키마)

## Global Constraints
- 브랜치 `core/briefing`, 폴더 `sidecar/src/vater_core/briefing/`, `api/routes/briefings.py`. 라벨 `area:core`. 다른 영역(`kis/`, `alerts/`, `llm/`) 파일은 고치지 않는다(가져다 쓰기만).
- **주문 API 없음**(`test_readonly_guarantee.py`). 한투 호출 우선순위는 `Priority.BRIEFING`.
- 설정(이미 있음): `briefing.kr.enabled`(true), `briefing.kr.time`("16:00"), `briefing.us.enabled`(true), `briefing.us.time`("07:00"). 시각은 모두 KST.
- 일정(스펙 6장): 국내 세션 S의 브리핑 시각 = max(S일 `briefing.kr.time` KST, S 마감 15:30 + 10분). 미국 세션 S(뉴욕 날짜)의 브리핑 시각 = max(S 다음 날(KST 날짜) `briefing.us.time` KST, S 폐장(XNYS, 조기 폐장 포함) + 10분). 휴장일에는 브리핑이 없다.
- 놓친 브리핑: **가장 최근 1회분만**. 순위·지수 현재값 API는 "지금" 값만 주므로, 그 시장의 다음 세션이 열리면 지난 세션 브리핑은 더 만들지 않는다.
- 수집 항목(스펙 6장): 국내 `indices`(KOSPI·KOSDAQ), `sectors`(업종 등락·상승/하락 종목 수, 두 시장), `movers`(상승률·하락률·거래대금 상위 각 10), `flows`(두 시장 외국인·기관·개인 순매수), `watchlist`(국내 감시 종목의 종가·등락률), `alerts`(그 세션에 울린 국내 알림). 미국 `indices`(SPX·COMP·NDX 현재값 + 최근 30거래일 종가), `watchlist`, `alerts`. 한투에 미국 업종·순위·수급 API가 없어서 미국 브리핑에는 그 항목이 없다(빠진 것이 아니라 해당 없음).
- 해석(스펙 6장): deep 모델 1회 호출. 출력 `{headline, market, sectors, flows, notable, watchlist}`, 모두 한국어 문장(해당 없으면 ""). **숫자 필드 없음.** 프롬프트에서 숫자를 반복하지 말라고 지시하고, 그래도 숫자(0~9)가 든 문장은 저장 전에 뺀다.
- 키는 환경변수가 아니라 LLM 클라이언트 인자(`api_key`)로만 넘긴다(분석과 동시에 돌아도 서로의 환경변수를 건드리지 않게).
- 부분 실패: 받은 항목으로 만들고 빠진 항목 이름을 `missing`에. LLM 실패도 부분 실패다(`missing`에 `"interpretation"`, 문장 없이 저장). 모든 수집 항목이 실패하면 저장하지 않고 5분 뒤 다시 시도한다.
- 결과: `briefings` 행(같은 시장·날짜는 덮어씀), Windows 알림 `notify("오늘의 시장 브리핑", "<국내|미국> <M/D> 브리핑이 도착했습니다", "/briefings/<id>")`, SSE `briefing.status` `{market, date, status: running|done|partial|failed, id?, error?}`, 알림 이력 `alert_events`에 `rule_id = NULL`, 문구 "시장 브리핑 도착: <국내|미국> <YYYY-MM-DD>".
- 오류 코드(새로): `BRIEFING_NOT_FOUND` 404, `BRIEFING_BUSY` 409, `BRIEFING_NO_SESSION` 409, `BRIEFING_NO_DATA` 502, `BRIEFING_LLM_FAILED`(저장 안 함, `missing`으로만 남음).
- core/alerts에서 넘겨받은 일: 미국 브리핑의 알림은 KST 날짜가 아니라 **뉴욕 세션 시간 범위**(그 세션 개장 ~ 브리핑 시각)로 찾는다.

## Review Focus
1. **앱이 브리핑 시각에 꺼져 있었다** → 다음 실행 때 가장 최근 1회분만 만든다. 그 시장의 다음 세션이 이미 열렸으면 지난 세션은 만들지 않는다(다른 날 데이터로 섞이지 않게). (Task 1)
2. **사용자가 브리핑 시각을 마감 전으로 바꿈**(예: 국내 15:00, 겨울철 미국 05:30) → 마감 + 10분 뒤에 만든다(미확정 데이터 금지). (Task 1)
3. **LLM이 숫자를 쓰거나 JSON이 아닌 답을 줌** → 숫자 문장은 빠지고, 해석이 안 되면 문장 없이 데이터만으로 저장된다(`missing`에 `interpretation`). (Task 4, 5)
4. **한투 일부 항목만 실패 / 인터넷 끊김** → 일부면 나머지로 저장, 모두 실패하면 저장하지 않고 다시 시도. 같은 세션을 1분마다 다시 만들지 않는다. (Task 3, 5)
5. **분석과 브리핑이 동시에 돎** → 브리핑은 환경변수를 건드리지 않는다. 브리핑은 한 번에 1건, 수동 실행 중 다시 누르면 `BRIEFING_BUSY`. (Task 4, 5, 6)

---

### Task 1: 일정

**Files:** Create `briefing/__init__.py`, `briefing/schedule.py` / Test `tests/briefing/test_schedule.py`

**Interfaces — Produces:**
- `BriefingMarket = Literal["KR", "US"]`
- `async due_session(market, now: datetime, clock: MarketClock, at: time) -> date | None` — 브리핑 시각이 지난 가장 최근 세션 S(국내는 KST 날짜, 미국은 뉴욕 날짜). 그 시장의 S 다음 세션 개장 시각이 이미 지났으면 None. 최근 15일 안에 세션이 없으면 None
- `slot_time(market, session: date, at: time) -> datetime`(동기, 휴장 여부는 보지 않음), `next_open(market, session, clock) -> datetime`(async)
- [ ] **Step 1: 실패하는 테스트** (휴장일 가짜: `MarketClock(가짜 국내 휴장일, now=...)`)
  - 국내 16:00 설정: 화 15:59 → 월 세션, 화 16:00 → 화 세션, 수 08:59 → 화, 수 09:00(다음 세션 개장) → None, 토 12:00 → 금, 월 08:00 → 금, 휴장일 다음 날 아침 → 휴장일 전 세션
  - 국내 15:00 설정 → 15:39는 아직 전 세션, 15:40부터 그날
  - 미국 07:00 설정: 11월(EST, 폐장 06:00 KST) 화 06:59 KST → 뉴욕 금 세션(월 세션 아님), 화 07:00 → 월 세션. 10월(EDT, 폐장 05:00 KST)도 07:00
  - 미국 05:30 설정, 11월 → 06:10 KST부터, 10월 → 05:30부터
  - 추수감사절(11/26 휴장) 다음 날 KST 07:00 → 11/25 세션, 조기 폐장 11/27(13:00 NY) → 11/28 07:00 KST에 11/27
  - 뉴욕 다음 세션 개장(23:30 KST, 11월) 이후에는 None
- [ ] **Step 2~4:** 실패 확인 → 구현(국내 마감·`SETTLE`·`KST`는 `alerts.clock`에서, 미국 개장·폐장은 `exchange_calendars` XNYS `session_open`·`session_close`·`next_session`) → `uv run pytest -q` 통과
- [ ] **Step 5: 커밋** — `feat(briefing): 브리핑 일정과 놓친 브리핑 판단`

### Task 2: 저장소

**Files:** Create `briefing/store.py` / Test `tests/briefing/test_briefing_store.py`

**Interfaces — Produces:**
- `@dataclass(frozen=True) Briefing(id, market, date: str, data: dict, text: dict[str, str] | None, status: Literal["done","partial"], missing: list[str], created_at)`
- `BriefingRepo(conn)`: `save(market, day: date, data, text, missing) -> int`(같은 시장·날짜면 덮어쓰고 id 유지, 새로 만들면 created_at 갱신 안 함은 신경 쓰지 않음; status는 `missing`이 비면 done, 아니면 partial), `get(id)`(없으면 `BRIEFING_NOT_FOUND` 404), `find(market, day) -> Briefing | None`, `list(market=None, limit=30)`(날짜·id 최신순)
- [ ] **Step 1~5:** 테스트(저장·조회 JSON 왕복, 덮어쓰기 후 id 같음·행 1개, partial/done, 목록 순서·시장 필터·limit, 없는 id 404) → 구현 → 커밋 `feat(briefing): 브리핑 저장소`

### Task 3: 수집

**Files:** Create `briefing/collect.py` / Test `tests/briefing/test_collect.py`

**Interfaces — Produces:**
- `class Feeds(Protocol)`: `index_quote(m: DomesticMarket)`, `sector_board(m)`, `fluctuation_rank(direction, limit)`, `trading_value_rank(limit)`, `investor_flows(m, day)`, `overseas_index(code, start, end)`, `price(item: WatchItem) -> Quote` (모두 async, `kis/market.py`·`kis/quotes.py`와 같은 반환형)
- `KisFeeds(client: KisClient)`: 위 함수를 `Priority.BRIEFING`으로 부르는 기본 구현(얇은 위임, 테스트하지 않음)
- `@dataclass Collected(data: dict[str, Any], missing: list[str])`
- `async collect(market, session: date, feeds: Feeds, db, *, alerts_until: datetime) -> Collected`
  - 항목 단위로 모아 `data[section]`에 JSON(dataclass → dict, 날짜는 ISO 문자열)으로 넣는다. 한 항목 안의 호출이 하나라도 실패하면 그 항목 전체를 `missing`에(반쪽 표 금지)
  - `watchlist`: 그 시장 감시 종목마다 `{code, name, price, change_pct}`. 종목 1개 실패는 그 종목만 빼고 경고 로그(감시 종목이 없으면 빈 목록, missing 아님)
  - `alerts`: `EventRepo(db).list(500)` 중 그 시장 규칙 알림이고 `fired_at`이 [세션 개장, `alerts_until`)인 것 `{fired_at, name, kind, message}` 오래된 순
  - 인터넷 끊김(`KIS_UNREACHABLE`, `httpx.TransportError`)은 그대로 올린다. 그 밖의 오류로 한투 항목이 **모두** 실패하면 `VaterError("BRIEFING_NO_DATA", ..., status=502)`
  - `data`에 `market`, `session`(ISO), `collected_at`(KST ISO)를 넣는다
- [ ] **Step 1~5:** 가짜 Feeds로: 국내 전 항목(값이 dataclass 그대로 JSON이 됨), 미국은 indices·watchlist·alerts만(sectors·movers·flows 키 없음, missing 아님), `flows`만 실패 → `missing == ["flows"]`, 업종 두 시장 중 하나 실패 → `sectors` 통째로 missing, 감시 종목 1개 실패 → 나머지만, 끊김은 그대로 전파, 모두 실패 → `BRIEFING_NO_DATA`, 미국 알림이 KST 자정을 넘는 세션 범위로 골라짐(범위 밖·국내 알림·`rule_id NULL` 이벤트 제외) → 커밋 `feat(briefing): 한투 데이터 수집과 부분 실패`

### Task 4: 해석 (LLM 1회)

**Files:** Create `briefing/interpret.py` / Test `tests/briefing/test_interpret.py`

**Interfaces — Produces:**
- `SECTIONS = ("headline", "market", "sectors", "flows", "notable", "watchlist")`
- `class ChatModel(Protocol)`: `invoke(messages: list[tuple[str, str]]) -> Any`(응답의 `.content`가 문자열 또는 블록 목록)
- `def build_messages(market, data: dict) -> list[tuple[str, str]]` — system(역할, 한국어, **숫자를 쓰지 말 것**, 해당 없는 항목은 "", JSON 객체만 출력, 키 6개)과 user(수집 데이터 JSON)
- `def parse_text(raw: str) -> dict[str, str]` — 코드 블록·앞뒤 말을 걷어 내고 첫 JSON 객체를 읽는다. 키 6개만 남기고(없으면 "", 문자열 아니면 거부), **숫자(0-9)가 든 문장은 뺀다**(문장 = `. ! ? 。` 또는 줄바꿈으로 나눔). 읽을 수 없으면 `VaterError("BRIEFING_LLM_FAILED", ..., status=502)`
- `def interpret(market, data, run: LlmRun, factory: Callable[[LlmRun], ChatModel] = deep_model) -> dict[str, str]`(동기, 서비스가 `asyncio.to_thread`로 부름). 호출 예외는 원문을 로그에만 남기고 `BRIEFING_LLM_FAILED`(메시지에는 예외 종류만)
- `def deep_model(run: LlmRun) -> ChatModel` — `create_tier_client({**DEFAULT_CONFIG, **run.overrides}, "deep", **_key_kwargs(run))`의 `.get_llm()`. `_key_kwargs(run)`: deep 제공자가 `ollama`면 `{}`, 아니면 `{"api_key": run.env[ENV_FOR_PROVIDER[제공자]]}`. **`os.environ`을 건드리지 않는다.** TradingAgents는 이 파일에서만 import한다
- [ ] **Step 1~5:** 테스트: 메시지에 데이터 JSON과 "숫자" 지시가 들어감, 코드 블록으로 감싼 JSON 해석, 키 누락은 "", 남는 키 무시, 문자열 아닌 값·JSON 없음 → `BRIEFING_LLM_FAILED`, "코스피가 2.3% 올랐다. 반도체가 강했다." → 둘째 문장만, 가짜 모델 예외 → `BRIEFING_LLM_FAILED`이고 메시지에 예외 원문 없음, `_key_kwargs`(google → `api_key`, ollama → 없음), `interpret` 전후로 `os.environ` 그대로 → 커밋 `feat(briefing): LLM 1회 해석과 숫자 문장 제거`

### Task 5: 서비스(만들기·일정 루프)

**Files:** Create `briefing/service.py` / Modify `api/deps.py`(`briefing: BriefingService | None`), `__main__.py`(시작·종료) / Test `tests/briefing/test_service.py`

**Interfaces — Produces:**
- `class BriefingService(deps, *, clock: MarketClock, feeds_fn: Callable[[], Feeds], run_fn: Callable[[], LlmRun], interpret_fn=interpret, notify_fn=notify, now=..., sleep=asyncio.sleep)`
  - `async generate(market, session: date) -> int` — 한 번에 1건(`asyncio.Lock`; 이미 돌면 `BRIEFING_BUSY` 409). SSE `running` → `collect`(alerts_until = now) → `run_fn()`과 `interpret`(`to_thread`; `VaterError`면 문장 없이 `missing += ["interpretation"]`, `run_fn`의 `LLM_*` 오류도 같게) → `BriefingRepo.save` → notify·SSE `done|partial`·`alert_events` 1행 → id. 수집 실패는 SSE `failed`(`error` = `{code, message}`) 후 그대로 올린다
  - `async run_latest(market) -> date` — 수동 실행: `clock.last_closed_session(market)`(없으면 `BRIEFING_NO_SESSION`)을 백그라운드 작업으로 만든다(바쁘면 `BRIEFING_BUSY`). 날짜를 돌려준다
  - `async tick_once()` — 켜진 시장마다 `due_session(market, now, clock, 설정 시각)`; 그 날짜 브리핑이 이미 있거나, 같은 세션이 5분 안에 실패했으면 건너뛴다. 인터넷 끊김·`BRIEFING_NO_DATA`·`BRIEFING_BUSY`는 5분 뒤 다시
  - `start()`(60초 루프), `async stop()`
- `get_briefing(deps) -> BriefingService` — 기본: `KisFeeds(require_kis(deps).client)`, `build_run(SettingsRepo(db).get_all(), load_catalog(), secrets)`, `MarketClock(국내 휴장일 = is_domestic_trading_day)`
- [ ] **Step 1~5:** 가짜 Feeds·가짜 interpret·가짜 notify로: 정상 1건(행 done, notify 문구·경로, SSE running→done, `alert_events` 1행 rule_id NULL), LLM 실패 → partial + `interpretation` missing(그래도 notify), LLM 키 없음(`LLM_KEY_MISSING`) → partial, 수집 모두 실패 → 행 없음·SSE failed, tick: 시각 전 → 없음, 시각 후 → 1건, 다시 tick → 그대로 1건, 꺼진 시장 → 없음, 끊김 후 5분 안 다시 시도 안 함·5분 뒤 다시, 같은 시장·날짜 수동 재생성은 덮어씀(id 같음), 동시에 두 번 → 둘째 `BRIEFING_BUSY`, start→stop 깔끔히 → 커밋 `feat(briefing): 브리핑 만들기와 일정 루프`

### Task 6: API

**Files:** Create `api/routes/briefings.py` / Modify `api/app.py`, OpenAPI 스냅샷 / Test `tests/api/test_briefings_api.py`

| 메서드·경로 | 요청 → 응답 |
|---|---|
| `GET /briefings?market=&limit=` | `[BriefingItem]` `{id, market, date, status, headline, missing, created_at}` (headline은 text가 없으면 null) |
| `GET /briefings/{id}` | `BriefingDetail` = Item + `data`, `text` |
| `POST /briefings/run` | `{market}` → 202 `{market, date}` (백그라운드로 만들고 진행은 SSE) |

- [ ] **Step 1~5:** 각 경로 정상·404·409(BUSY, NO_SESSION)·422(market 틀림)·401 → 스냅샷 갱신(추가만 있는지 확인) → 커밋 `feat(briefing): 브리핑 API`

### Task 7: 실연동과 README

**Files:** Create `tests/briefing_live/test_briefing_live.py` / Modify `sidecar/README.md`

- [ ] **Step 1 (`@pytest.mark.kis_live`)**: 실제 한투로 국내·미국 `collect` → `missing == []`, 국내 지수 2개·업종 두 시장·순위 3종·수급 두 시장, 미국 지수 3개·각 30개 종가. 받은 수치를 출력
- [ ] **Step 2 (`@pytest.mark.llm`, 루트 `.env`에 클라우드 키가 있을 때)**: 실제 수집 + 실제 deep 모델(설정 기본 프리셋)로 국내 `generate` 1건 → status done, 문장 6개가 모두 문자열, 숫자 없음, 출력. 호출 한도 등 LLM 문제면 사유를 남기고 skip(사용자 규칙)
- [ ] **Step 3: README**(briefing 폴더 표, SSE, API, 실연동 명령), 전체 검사, 커밋 `test(briefing): 실연동 확인과 README`
