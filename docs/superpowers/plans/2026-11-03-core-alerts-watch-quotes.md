# core/alerts-watch-quotes 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈 화면의 "감시 종목 목록(현재가, 등락, 수신 상태)"(스펙 9-2)과 상태 표시줄의 "시장 상태, 한투 연결 상태"(9-1)에 필요한 데이터를 사이드카가 준다. 스펙 2-2의 SSE "시세 갱신"을 만든다.

**발견 경위:** 디자인 시스템 리뷰와 화면 준비 중 발견. 3단계 확인 테스트 계획이 이 항목을 빠뜨렸다.

**Architecture:** 감시 루프(`alerts/monitor.py`)가 이미 틱·폴링으로 가격을 받는다. 이를 종목별 최신 시세로 보관해 SSE로 내보내고, 상태에 시장·종목별 수신 상태를 더한다. 감시 루프에 시세가 없을 때(앱 시작 직후, 장 마감, 장중 감시 규칙이 없는 종목)는 `GET /watchlist/quotes`가 REST 현재가를 30초 캐시로 채운다.

**Spec:** `docs/superpowers/specs/2026-11-02-vater-mvp-design.md` 2-2(SSE 시세 갱신), 9-1(상태 표시줄), 9-2(홈)

## Global Constraints
- 브랜치 `core/alerts-watch-quotes`, 파일 `alerts/monitor.py`, `api/routes/watchlist.py`, `api/routes/alerts.py`(상태 모델). 라벨 `area:core`. 주문 API 없음.
- SSE `quote` `{market, code, price, change, change_pct, at, source: "realtime"|"polling"|"rest"}` — 종목당 1초에 최대 1번(틱 평가와 같은 주기). `change`는 전일 대비 금액(한투 실시간 체결에는 없으므로 그날 처음 받은 REST 현재가의 `price - change`를 전일 종가로 두고 계산, 전일 종가를 모르면 `null`).
- 상태(`GET /alerts/status`, SSE `alerts.state`)에 더함: `markets: {KR: "open"|"closed", US: "open"|"closed"}`, `feeds: [{market, code, feed}]` — `feed`는 `realtime`(구독·연결됨·거부 아님) / `polling`(장중 폴링) / `closed`(그 시장이 닫힘) / `idle`(장중이지만 실시간 규칙이 없어 감시하지 않음) / `offline`(인터넷 끊김). 기존 `state, realtime, polling`은 그대로(호환).
- `GET /watchlist/quotes` → 감시 종목마다 `{watchlist_id, market, code, name, price, change, change_pct, at, source, feed}`. 감시 루프의 시세가 60초 안이면 그것을, 아니면 REST(`Priority.ALERTS`) 결과를 30초 캐시. 한투 키 없음·끊김·종목 오류는 그 종목만 `price: null`(전체 실패 아님).

## Review Focus
1. **앱 시작 직후·장 마감 후** → 감시 루프에 시세가 없어도 홈에 가격이 보인다(REST). (Task 2)
2. **틱이 초당 수십 번** → SSE `quote`가 종목당 1초 1번을 넘지 않는다. (Task 1)
3. **실시간 틱의 전일 대비 금액** → 전일 종가를 모르면 지어내지 않고 `null`. (Task 1)
4. **한투 끊김** → 상태의 종목별 `offline`, `/watchlist/quotes`는 실패하지 않고 가격만 `null`. (Task 1, 2)
5. **감시 종목 삭제** → 그 종목의 시세·수신 상태가 사라진다. (Task 1)

---

### Task 1: 감시 루프의 종목별 시세·수신 상태·시장 상태
**Files:** `alerts/monitor.py` / Test `tests/alerts/test_monitor.py`
- `Quote`(시세) 보관: `quotes() -> dict[Key, WatchQuote]`(`WatchQuote(price, change, change_pct, at, source)`), 틱 평가·폴링 때 갱신하고 SSE `quote` 발행. 폴링(REST)은 `change`가 있으므로 그 값으로 전일 종가를 기억(세션 날짜별), 틱은 그 전일 종가로 `change` 계산
- `status()`에 `markets`, `feeds` 추가(회차마다 계산, 일시 중지 중에는 마지막 값)
- [ ] 테스트: 틱 → SSE quote(1초 제한 안에서 1번), 폴링 → quote(source polling, change 있음), 폴링 뒤 틱 → change 계산, 전일 종가 모름 → change null, 상태의 markets(KR open, US closed), feeds(실시간·폴링·한도 초과·거부·끊김 중 폴링·닫힌 시장·실시간 규칙 없음 idle·오프라인), 감시 종목 삭제 뒤 시세·feed 사라짐 → 구현 → 커밋 `feat(alerts): 감시 종목 시세 SSE와 종목별 수신 상태·시장 상태`

### Task 2: `GET /watchlist/quotes`
**Files:** `alerts/monitor.py`(REST 보충 함수 주입), `api/routes/watchlist.py`, `api/routes/alerts.py`(상태 모델 확장), OpenAPI 스냅샷 / Test `tests/api/test_alerts_api.py`
- 감시 루프 시세가 60초 안이면 그대로, 아니면 REST 30초 캐시. 키 없음·끊김·종목 오류는 그 종목만 `price: null`, `feed`는 상태 그대로(끊김이면 `offline`)
- [ ] 테스트: 감시 루프 시세 사용, 오래됐으면 REST, 30초 캐시(한투 1번만), 종목 1개 실패해도 나머지, 키 없음, 상태 모델에 markets·feeds(스냅샷 추가만) → 커밋 `feat(alerts): 감시 종목 현재가 API`

### Task 3: 확인 테스트와 실연동
**Files:** `tests/alerts_live/test_alerts_live.py`(실제 키로 `/watchlist/quotes`·SSE quote)
- [ ] 국내 장중이면 실제 틱으로 SSE quote와 change 확인, 장 외면 REST 보충 확인 → README → 커밋 `test(alerts): 감시 종목 시세 실연동과 README`
