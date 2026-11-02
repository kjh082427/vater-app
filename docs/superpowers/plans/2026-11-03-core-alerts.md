# core/alerts 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 감시 종목과 알림 규칙(가격·지표·거래량·신고가), 장중 실시간 감시(WebSocket + 폴링), 장 마감 후 평가, 알림 전달(Windows 알림 + SSE + 이력)을 만든다.

**Architecture:**
- `sidecar/src/vater_core/alerts/` 아래:
  - `indicators.py`: 순수 함수(numpy/pandas). SMA, EMA, RSI(Wilder), MACD, 볼린저, 거래량 평균, 52주 최고·최저
  - `rules.py`: 규칙 종류별 파라미터(pydantic)와 조건 판정 순수 함수 `condition(rule, history, live) -> Reading`
  - `store.py`: `watchlist`, `alert_rules`, `alert_events`, `daily_bars`(새 마이그레이션 003)
  - `clock.py`: 장 운영 시간·휴장일(국내 한투 휴장일 API + 캐시, 미국 `exchange_calendars`)
  - `bars.py`: 일봉 갱신(최근 260거래일, 장 마감 후 하루 1번)
  - `evaluator.py`: 상태 전이(거짓→참)와 쿨다운, 발생 기록·알림
  - `monitor.py`: 장중 실시간 감시(WebSocket 구독 + 넘친 종목·끊김은 REST 폴링), 장 마감 후 평가, 일시 중지, 오프라인 처리
- 라우트 `api/routes/watchlist.py`, `api/routes/alerts.py`.
- **DB 쓰기는 모두 이벤트 루프에서** 한다. 틱 콜백도 루프에서 불린다(`KisRealtime`이 루프에서 돈다).

**Tech Stack:** numpy·pandas(이미 있음), `exchange_calendars==4.13.2`(새 의존성), `ta-lib==0.8.2`(개발 의존성, 지표 정확성 비교용. 0.8.3은 배포 2주가 안 돼서 쓰지 않음), 기존 `kis/ws.KisRealtime`, `kis/quotes`, `EventBus`, `notify`

**Spec:** `docs/superpowers/specs/2026-11-02-vater-mvp-design.md` 4장(알림), 7-3(WebSocket), 8장(오류: 인터넷 끊김, WebSocket 끊김), 2-3(API)

## Global Constraints
- 브랜치 `core/alerts`, 폴더 `sidecar/src/vater_core/alerts/`, `api/routes/{watchlist,alerts}.py`, 마이그레이션 `store/migrations/003_daily_bars.sql`. 라벨 `area:core`.
- **주문 API 없음**(`test_readonly_guarantee.py`).
- 규칙 종류와 기본값(스펙 4-1):

| kind | params(기본값) | 기본 timing |
|---|---|---|
| `price_above` / `price_below` | `price` (필수) | realtime |
| `change_pct` | `pct=5.0`, `direction=up\|down\|both` (기본 both) | realtime |
| `ma_cross` | `fast=5`, `slow=20`, `direction=golden\|dead` | close |
| `ma_break` | `period=20`, `direction=above\|below` | close |
| `rsi` | `period=14`, `upper=70`, `lower=30`, `direction=overbought\|oversold` | close |
| `macd_cross` | `fast=12`, `slow=26`, `signal=9`, `direction=golden\|dead` | close |
| `bollinger` | `period=20`, `k=2.0`, `direction=upper\|lower` | close |
| `volume_spike` | `period=20`, `multiple=3.0` | realtime |
| `new_high_low` | `direction=high\|low` (52주 = 최근 252거래일) | realtime |

- 평가(스펙 4-2):
  - **상태가 거짓→참으로 바뀔 때만** 발생. 처음 평가(직전 상태 없음)는 기준값만 저장하고 발생시키지 않는다.
  - 같은 규칙은 **하루 최대 1회**(그 시장의 현지 날짜 기준).
  - `close`: 확정 일봉으로. `realtime`: 현재가를 오늘 종가로 가정(잠정). 규칙마다 timing을 바꿀 수 있다.
  - 지표 계산에는 최근 260거래일을 쓴다.
- 장 운영 시간: 국내 09:00~15:30 `Asia/Seoul`, 미국 09:30~16:00 `America/New_York`. 휴장일: 국내 한투 `is_domestic_trading_day`(하루 1번 확인해 캐시), 미국 `exchange_calendars` `XNYS`. 장 외 시간에는 실시간 감시를 쉰다.
- 장 마감 후 평가 시각: 국내 15:40 KST, 미국 16:10 NY 이후 첫 확인(30초 루프) 때 하루 1번.
- 시세: WebSocket 구독 한도 `kis.ws_max_subscriptions`(기본 41). 넘친 종목과 끊긴 동안은 REST 폴링 `alerts.poll_interval_sec`(기본 30초).
- 오프라인(스펙 8장): REST 호출이 연결 오류로 실패하면 상태 `offline`, 30초마다 다시 확인, 복구되면 자동 재개.
- 전달: stdout `notify(title, body, route)` + SSE `alert.fired` + `alert_events` 행. route는 `/symbols/<market>/<code>`.
- SSE 상태: `alerts.state` `{state: running|paused|offline|closed, realtime: n, polling: n}`.
- 이벤트 알림(AI 분석 완료, 브리핑 도착)은 규칙이 아니다. `EventBus`의 `analysis.status`(done/failed)를 구독해 `alert_events`에 `rule_id = NULL`로 기록한다(알림 자체는 분석 큐가 이미 보낸다). 브리핑은 `core/briefing`이 같은 방식으로 기록한다.
- 오류 코드(새로): `WATCHLIST_DUPLICATE` 409, `WATCHLIST_NOT_FOUND` 404, `ALERT_RULE_INVALID` 422, `ALERT_RULE_NOT_FOUND` 404.

## Review Focus
1. **규칙을 만든 순간 이미 조건이 참** → 알림이 바로 쏟아지지 않는다(기준값만 저장). (Task 6)
2. **장중에 같은 조건이 참↔거짓을 오가며 깜빡임** → 하루 1회 쿨다운으로 1번만 알린다. (Task 6)
3. **WebSocket이 끊기거나 구독 한도를 넘음** → 해당 종목은 폴링으로 계속 감시하고, 다시 연결되면 실시간으로 돌아간다. (Task 7)
4. **인터넷이 끊김** → `offline`으로 알리고 감시가 죽지 않으며, 복구되면 재개한다. (Task 7)
5. **일봉이 부족한 신규 상장 종목** → 지표 규칙은 "계산 불가"로 상태를 바꾸지 않는다(오탐 없음). (Task 2, 6)

---

### Task 1: 지표 함수

**Files:** Create `alerts/__init__.py`, `alerts/indicators.py` / Test `tests/alerts/test_indicators.py` / Modify `pyproject.toml`(dev: `ta-lib==0.8.2`)

**Interfaces — Produces:** 모두 `pandas.Series[float]`(입력과 같은 길이, 앞부분 NaN) 또는 float를 돌려주는 순수 함수
- `sma(close, n)`, `ema(close, n)`(adjust=False, 첫 값은 SMA로 시작 — TA-Lib과 같게), `rsi(close, n=14)`(Wilder 평활), `macd(close, fast=12, slow=26, signal=9) -> (macd, signal, hist)`, `bollinger(close, n=20, k=2.0) -> (mid, upper, lower)`(모표준편차 ddof=0 — TA-Lib과 같게), `volume_ma(volume, n=20)`, `rolling_high(high, n=252)`, `rolling_low(low, n=252)`

- [ ] **Step 1: 실패하는 테스트.** 고정 시드의 300일 가짜 시세로 TA-Lib(`talib.SMA/EMA/RSI/MACD/BBANDS`)과 비교: NaN 위치가 같고 값 차이 `< 1e-6`. 손으로 계산 가능한 작은 예(`sma([1,2,3,4],2) = [nan,1.5,2.5,3.5]`, 모두 오르는 시세의 RSI = 100)도 넣는다. TA-Lib을 설치할 수 없는 환경이면 비교 테스트만 skip
- [ ] **Step 2~4:** 실패 확인 → 구현 → `uv run pytest -q` 통과
- [ ] **Step 5: 커밋** — `feat(alerts): 기술 지표 함수`

### Task 2: 규칙 종류와 조건 판정

**Files:** Create `alerts/rules.py` / Test `tests/alerts/test_rules.py`

**Interfaces — Produces:**
- 파라미터 모델(pydantic, `extra="forbid"`): 위 표의 kind별 클래스. `parse_rule(kind: str, params: dict) -> RuleParams`(틀리면 `ALERT_RULE_INVALID` 422, 메시지에 필드 이름), `default_timing(kind) -> Literal["realtime","close"]`
- `@dataclass(frozen=True) History(days: tuple[date, ...], open, high, low, close, volume: tuple[float, ...])` (오래된 것부터, 확정 일봉)
- `@dataclass(frozen=True) Live(price: float, change_pct: float, volume: int)`
- `@dataclass(frozen=True) Reading(state: bool | None, value: float | None, message: str)` (`None` = 계산 불가: 데이터 부족)
- `condition(params: RuleParams, history: History, live: Live | None) -> Reading` — `live`가 있으면 현재가를 오늘 종가로 붙여 계산(잠정)
  - 교차류(`ma_cross`, `macd_cross`)는 "마지막 두 값 사이에 교차가 일어났는가"가 아니라 **현재 위/아래 상태**(golden이면 fast > slow)를 state로 쓴다. 상태 전이(거짓→참)가 곧 교차다
  - `message`는 한국어(예: "삼성전자 RSI(14) 72.3 — 과매수 진입")에 쓸 수 있게 종목명 없이 조건 부분만
- [ ] **Step 1: 실패하는 테스트**: 종류별로 참·거짓·계산 불가(일봉 부족) 각 1개, 잘못된 파라미터(`fast >= slow`, 음수 가격, 모르는 kind, 남는 필드) → `ALERT_RULE_INVALID`, realtime 잠정 계산이 마지막 종가를 현재가로 바꾼 것과 같음
- [ ] **Step 2~4:** 실패 확인 → 구현 → 통과
- [ ] **Step 5: 커밋** — `feat(alerts): 알림 규칙 종류와 조건 판정`

### Task 3: 저장소와 일봉 테이블

**Files:** Create `store/migrations/003_daily_bars.sql`, `alerts/store.py` / Test `tests/alerts/test_alerts_store.py`

`daily_bars(market, code, day TEXT, open, high, low, close REAL, volume INTEGER, PRIMARY KEY(market, code, day))`

**Interfaces — Produces:**
- `WatchItem(id, market, code, exchange, name, created_at)`, `Rule(id, watchlist_id, kind, params: dict, timing, enabled, last_state: bool | None, last_fired_at: str | None)`, `AlertEvent(id, rule_id, fired_at, value, message, market, code, name, kind)`
- `WatchlistRepo(conn)`: `list()`, `add(target: Target)`(중복 `WATCHLIST_DUPLICATE`), `remove(id)`(규칙도 함께 지움 — FK CASCADE), `get(id)`
- `RuleRepo(conn)`: `list(watchlist_id=None, enabled_only=False)`, `create(watchlist_id, kind, params, timing, enabled)`, `update(id, params=None, timing=None, enabled=None)`(params가 바뀌면 `last_state`를 지운다: 새 기준값), `delete(id)`, `set_state(id, state)`, `mark_fired(id, at)`
- `EventRepo(conn)`: `add(rule_id, fired_at, value, message)`, `list(limit=100)`(최신순, 종목 정보 조인)
- `BarRepo(conn)`: `upsert(market, code, bars: list[Bar])`, `history(market, code, limit=260) -> History`, `last_day(market, code) -> date | None`
- [ ] **Step 1~5:** 테스트(각 메서드, 중복, CASCADE, 마이그레이션 버전 증가) → 구현 → 커밋 `feat(alerts): 감시 종목·규칙·발생·일봉 저장소`

### Task 4: 장 운영 시계

**Files:** Create `alerts/clock.py` / Test `tests/alerts/test_clock.py` / Modify `pyproject.toml`(`exchange_calendars==4.13.2`)

**Interfaces — Produces:**
- `class MarketClock(kr_trading_day: Callable[[date], Awaitable[bool]], now: Callable[[], datetime])`
  - `async is_open(market) -> bool`, `async session_date(market) -> date`(현지 날짜), `async after_close(market) -> bool`(오늘이 거래일이고 마감 + 10분이 지남)
  - 국내 거래일 여부는 날짜별로 캐시한다(한투 호출은 하루 1번). 한투 실패 시 주말만 거른다(로그 경고)
  - 미국은 `exchange_calendars.get_calendar("XNYS").is_session(day)`, 조기 폐장은 `session_close`를 쓴다
- [ ] **Step 1~5:** 테스트(국내 장중·장전·장후·휴일·주말, 미국 서머타임 전후, 추수감사절 다음날 조기 폐장 13:00, 캐시가 한투를 하루 1번만 부름) → 구현 → 커밋 `feat(alerts): 장 운영 시간과 휴장일`

### Task 5: 일봉 갱신

**Files:** Create `alerts/bars.py` / Test `tests/alerts/test_bars.py`

**Interfaces — Produces:** `async refresh_bars(client: KisClient, repo: BarRepo, item: WatchItem, today: date) -> int` (국내 `domestic_daily`, 미국 `overseas_daily`, 기간 = 오늘부터 400일 전. 저장한 행 수). 이미 오늘 것까지 있으면 호출하지 않는다.
- [ ] **Step 1~5:** respx로 국내·미국 각 1개, 이미 최신이면 0회 호출 → 커밋 `feat(alerts): 일봉 갱신`

### Task 6: 평가기(상태 전이·쿨다운·발생)

**Files:** Create `alerts/evaluator.py` / Test `tests/alerts/test_evaluator.py`

**Interfaces — Produces:**
- `class Evaluator(conn, events: EventBus, notify_fn, now)`: `evaluate(item: WatchItem, rules: list[Rule], history: History, live: Live | None, session_day: date) -> list[AlertEvent]`
  - 각 규칙: `condition()` → `state is None`이면 아무것도 바꾸지 않음 → 직전 상태 없음: 저장만 → 거짓→참이고 오늘 아직 안 울렸으면 발생: `EventRepo.add`, `RuleRepo.mark_fired`, `notify("알림: <종목명>", <message>, "/symbols/<market>/<code>")`, SSE `alert.fired` → 상태 저장
  - `live`가 있을 때는 `timing == "realtime"` 규칙만, 없을 때는 `close` 규칙만 평가
- `record_event_alerts(bus, conn) -> Callable[[], None]`: `analysis.status`(done/failed)를 받아 `alert_events`에 `rule_id = NULL`로 기록하는 구독을 시작한다(해제 함수 반환)
- [ ] **Step 1~5:** 테스트(Review Focus 1·2·5, realtime/close 분리, notify 내용, 비활성 규칙 제외, 분석 완료 기록) → 구현 → 커밋 `feat(alerts): 상태 전이와 쿨다운 평가기`

### Task 7: 감시 루프

**Files:** Create `alerts/monitor.py` / Modify `api/deps.py`(`alerts: AlertMonitor | None`), `__main__.py`(시작·종료) / Test `tests/alerts/test_monitor.py`

**Interfaces — Produces:**
- `class AlertMonitor(deps, *, clock: MarketClock, realtime_factory, price_fn, sleep)`: `start()`, `async stop()`, `pause()`, `resume()`, `status() -> dict`(`state`, `realtime`, `polling`), `async tick_once()`(테스트용: 루프 1회)
  - 30초마다(`tick_once`): 열린 시장의 감시 종목 중 realtime 규칙이 있는 종목을 WebSocket에 구독(한도 안), 나머지는 `alerts.poll_interval_sec`마다 REST 현재가로 평가. 장이 닫힌 시장은 구독을 해제한다. 마감 후 첫 회에는 일봉을 갱신하고 close 규칙을 평가한다(시장별 하루 1번)
  - 틱 콜백: 종목별 최신가를 갱신하고 1초에 최대 1번 평가
  - WebSocket 상태가 `reconnecting`이면 그 동안 모든 종목을 폴링으로 평가
  - REST가 `httpx.ConnectError`/`KIS_UNREACHABLE`이면 `offline`, 다음 회차에 다시 시도
  - `paused`면 아무것도 하지 않는다(상태만 알림)
- [ ] **Step 1~5:** 가짜 시계·가짜 실시간·가짜 가격 함수로: 장중 구독·한도 초과 종목 폴링, 끊김 중 폴링, 오프라인→복구, 마감 후 하루 1번 평가, 일시 중지 → 구현 → 커밋 `feat(alerts): 장중 실시간·폴링 감시와 장 마감 후 평가`

### Task 8: API

**Files:** Create `api/routes/watchlist.py`, `api/routes/alerts.py` / Modify `api/app.py`, OpenAPI 스냅샷 / Test `tests/api/test_alerts_api.py`

| 메서드·경로 | 요청 → 응답 |
|---|---|
| `GET /watchlist` | `[WatchItem]` |
| `POST /watchlist` | `{market, code}` → 201 `WatchItem` (종목 마스터에서 거래소·이름) |
| `DELETE /watchlist/{id}` | 204 |
| `GET /alerts/rules?watchlist_id=` | `[Rule]` |
| `POST /alerts/rules` | `{watchlist_id, kind, params?, timing?, enabled?}` → 201 `Rule` (params 생략 시 기본값) |
| `PATCH /alerts/rules/{id}` | `{params?, timing?, enabled?}` → `Rule` |
| `DELETE /alerts/rules/{id}` | 204 |
| `GET /alerts/events?limit=` | `[AlertEvent]` |
| `POST /alerts/pause`, `POST /alerts/resume` | `{state}` |
| `GET /alerts/status` | `{state, realtime, polling}` |
| `GET /alerts/kinds` | kind별 기본 params·기본 timing (UI 폼용) |

- [ ] **Step 1~5:** 각 경로의 정상·오류·인증, 스냅샷 의미 비교 → 커밋 `feat(alerts): 감시 종목·알림 API`

### Task 9: 실연동 확인과 README

**Files:** Create `tests/alerts_live/test_alerts_live.py`(`@pytest.mark.kis_live`) / Modify `README.md`, `docs/kis-live-findings.md`

- [ ] **Step 1: 국내 실시간 체결(`H0STCNT0`) 필드 위치 확인** (국내 장중 09:00~15:30에만): 삼성전자 구독 → 틱 10개 이상, 코드 `005930`, 가격이 REST 현재가와 ±1% 안, 등락률이 REST 등락률과 ±0.5%p 안, 누적거래량이 늘어남. 결과를 `docs/kis-live-findings.md`에 기록. 장 외 시간이면 skip(사유 출력)
- [ ] **Step 2: 끝까지 확인**: 삼성전자 감시 + `price_above`(현재가의 50%) 규칙 → 첫 평가는 기준값 → 규칙을 고쳐 기준값을 지우고 상태를 거짓으로 만든 뒤 다시 평가해 1번 발생, `alert_events` 1행
- [ ] **Step 3: README**, 전체 검사, 커밋 `test(alerts): 국내 실시간 필드 실연동 확인과 README`
