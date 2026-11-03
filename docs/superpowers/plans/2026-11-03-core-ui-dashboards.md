# core/ui-dashboards 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대시보드 배치를 사이드카에 저장하는 API(`GET/PUT /ui/dashboards`)와, 지수 칸·숫자 카드용 지수 API(`GET /market/indices`)를 만든다.

**Architecture:**
- **배치 문서:** settings 테이블의 별도 키 `ui.dashboards`에 JSON 그대로 저장한다. 일반 설정 목록(`SETTING_DEFS`)·검증 경로와는 따로 두고, `DashboardRepo`가 모양만 검사한다(내용 종류의 뜻은 화면이 검사).
- **지수:** 이미 있는 `index_quote`·`index_daily`·`overseas_index`를 묶는 `IndexBoard`가 맡는다. 30초 캐시와 동시 요청 합치기를 하고, 실패한 지수만 `value: null`로 준다.

**Tech Stack:** Python 3.13, FastAPI, pydantic, sqlite3, pytest(+respx, time 주입)

**Spec:** `docs/superpowers/specs/2026-11-03-dashboard-design.md` 4장(사이드카 추가), 6장(오류), 7장(테스트). 상위: `2026-11-02-vater-mvp-design.md` 2-3·7·8장.

## Global Constraints
- 브랜치 `core/ui-dashboards`, 라벨 `area:core`. **주문·정정·취소 API 없음**(`tests/test_readonly_guarantee.py`).
- 오류는 `VaterError(code, message, hint, status)` → `{code, message, hint}`. 새 코드는 `DASHBOARD_INVALID`(422)다.
- 문서 제한(스펙 4장): 본문 64KB 이하, `version == 1`, 대시보드 1~8장(PUT), 이름 1~20자(앞뒤 공백 제거 뒤), 칸 1~6개, `kpi.items` 0~5개.
- `GET /ui/dashboards`: 저장된 것이 없으면 `{"version": 1, "dashboards": []}`.
- `GET /market/indices`: 순서는 코스피, 코스닥, S&P 500, 나스닥(종합 `COMP`)이다. 각 항목은 `{code, name, market: "KR"|"US", value, change, change_pct, at, closes}`이고, `closes`는 최근 30거래일 종가(오래된 것부터, 오늘의 미확정 봉 제외)다. 이름은 `코스피`, `코스닥`, `S&P 500`, `나스닥`이다.
- 캐시는 30초다. 한투 키가 없으면 4개 모두 `value/change/change_pct: null`, `closes: []`이고 200이다.
- OpenAPI 스냅샷(`tests/snapshots/openapi.json`)은 추가만 한다. 기존 경로는 바뀌지 않는다.
- 테스트를 먼저 쓴다. 테스트 실행과 커밋은 따로 단계로 한다(파이프로 결과를 숨기지 않음).

## Review Focus
1. **64KB 경계와 깨진 JSON 본문** → 422 `DASHBOARD_INVALID`(500 아님), 저장된 기존 문서는 그대로. (Task 1)
2. **재시작 뒤 유지** → 같은 DB로 앱을 다시 만들면 같은 문서. (Task 1)
3. **지수 하나만 실패**(한투 오류·빈 output) → 그 지수만 null, 나머지는 값. (Task 2)
4. **30초 안에 여러 칸이 동시에 요청** → 한투 호출은 지수마다 1번. (Task 2)
5. **장중의 오늘 미확정 봉** → `closes`에 넣지 않는다(오늘 값은 `value`). (Task 2)

---

### Task 1: 대시보드 문서 저장 API
**Files:** Create `src/vater_core/store/dashboards.py`, `src/vater_core/api/routes/ui.py` / Modify `src/vater_core/api/app.py`(라우터 등록), `tests/snapshots/openapi.json` / Test `tests/api/test_ui_dashboards_api.py`, `tests/store/test_dashboards.py`

**Interfaces:**
- Produces
  - `class DashboardRepo(conn)`: `get() -> dict`, `put(doc: dict) -> dict`(검사 뒤 저장, 저장한 문서를 돌려줌)
  - `validate_dashboards(doc: Any) -> None`(틀리면 `VaterError("DASHBOARD_INVALID", ..., hint, 422)`)
  - 라우트: `GET /ui/dashboards`, `PUT /ui/dashboards`(본문 = 문서)
- pydantic 응답 모델 `DashboardsDoc`: `version: int`, `dashboards: list[DashboardOut]`. `DashboardOut`은 `id: str`, `name: str`, `kpi: {enabled: bool, items: list[str]}`, `layout: {template: str, root: dict}`, `panels: list[{type: str, options: dict}]`다. 화면의 `schema.d.ts`가 이 모양을 받는다.

- [ ] 테스트(실패 확인)
  - 처음 `GET` → `{"version":1,"dashboards":[]}`
  - 정상 문서 `PUT` → 200, 같은 문서를 돌려줌 → `GET`이 같음
  - 422 + `DASHBOARD_INVALID` + hint가 비어 있지 않음
    - 대시보드 0장, 9장
    - 이름 "" 또는 21자
    - 칸 0개, 7개
    - `kpi.items` 6개
    - `version` 2
    - 본문이 64KB 초과(예: 옵션 문자열로 70KB)
    - JSON이 아님
    - 최상위가 배열
  - 422 뒤에도 이전에 저장한 문서가 그대로
  - DB를 닫고 같은 데이터 폴더로 앱을 다시 만들면 같은 문서
  - 토큰 없이 401
  - `GET /settings` 응답에 `ui.dashboards` 키가 없음
- [ ] 구현
  - 크기 검사는 원본 본문 바이트(`Request.body()`)로 한다.
  - id는 1~40자 문자열이다. `template`·`type`은 1~40자 문자열이다. `root`·`options`는 객체다.
  - 저장은 `INSERT … ON CONFLICT(key) DO UPDATE`이고 `json.dumps(ensure_ascii=False)`로 한다.
- [ ] OpenAPI 스냅샷 갱신(추가만), `uv run pytest -q` 전체 통과, ruff·mypy
- [ ] 커밋 `feat(ui-api): 대시보드 배치 저장 API`

### Task 2: 지수 API
**Files:** Create `src/vater_core/market/__init__.py`, `src/vater_core/market/indices.py`, `src/vater_core/api/routes/market.py` / Modify `api/app.py`, `api/deps.py`(`indices: IndexBoard | None`), 스냅샷 / Test `tests/market/test_indices.py`, `tests/api/test_market_api.py`

**Interfaces:**
- Consumes: `kis.market.index_quote(c, "KOSPI"|"KOSDAQ")`, `index_daily(c, market, start, end)`, `overseas_index(c, "SPX"|"COMP", start, end)`, `kis.services.get_kis(deps)`
- Produces
  - `@dataclass IndexRow(code, name, market, value: float|None, change: float|None, change_pct: float|None, at: datetime|None, closes: list[float])`
  - `class IndexBoard(fetch: IndexFetcher, now: Callable[[], float] = time.monotonic, clock: Callable[[], datetime])`: `async rows() -> list[IndexRow]`
  - `IndexFetcher`는 Protocol(`kr_quote`, `kr_daily`, `us_index`)이다. 테스트는 가짜 Fetcher를 쓴다.
  - 라우트 `GET /market/indices -> list[IndexOut]`

- [ ] 테스트(실패 확인)
  - 정상: 4개 순서와 이름, closes 30개, 오래된 것부터
  - 국내 일봉 마지막이 오늘 날짜면 closes에서 뺌
  - 코스닥 실패 → 코스닥만 null, 다른 3개는 값
  - 30초 안에 `rows()`를 두 번 부르면 Fetcher 호출이 지수마다 1번이다. 31초 뒤에는 다시 부른다(가짜 monotonic 시계).
  - 동시에 `rows()`를 5번 → Fetcher 호출이 지수마다 1번
  - API: 한투 키가 없으면 200이고 4개 모두 null·`closes: []`
  - 401
- [ ] 구현
  - 기간은 `오늘 − 60일 ~ 오늘`로 받고 마지막 30개를 쓴다.
  - 한투 함수는 이미 `Priority.BRIEFING`이다(알림 감시보다 뒤).
  - 키가 바뀌면 `get_kis`가 새 클라이언트를 주므로 캐시도 함께 버린다(fingerprint 비교).
- [ ] 스냅샷 갱신, 전체 테스트·ruff·mypy
- [ ] 커밋 `feat(market): 지수 현재값과 30거래일 종가 API`

### Task 3: 실연동 확인과 문서
**Files:** `tests/kis_live/test_indices_live.py`(`@pytest.mark.kis_live`), `sidecar/README.md`(API 목록), `docs/ARCHITECTURE.md`는 PR 뒤 main에서
- [ ] 실제 키로 `/market/indices`: 4개 모두 값이 있고 closes가 20개 이상(휴장 고려). 장중이면 코스피 `value`가 마지막 종가와 다를 수 있음을 기록만 한다.
- [ ] `uv run pytest -m kis_live tests/kis_live/test_indices_live.py -q -s` 통과
- [ ] 커밋 `test(market): 지수 API 실연동과 README`
