# core/portfolio 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 평가금액 계산, 주가 조회 주기 설정, 종목 일봉 API, 환율, 자산 추이 기록, 평단가 알림, 브리핑 개인화를 만든다.

**Architecture:** `portfolio/` 패키지가 평가·기록을 맡고, 알림은 기존 `alerts/rules.py`와 평가기에, 브리핑은 `briefing/collect.py`에 더한다.

**Spec:** v2 설계 3, 4-1, 4-4, 6, 12, 13, 15장. 선행: `core/holdings`.

## Global Constraints
- 라벨 `area:core`. 주문 없음.
- 새 마이그레이션 `005_portfolio.sql`: `portfolio_daily(day TEXT PK, kr_value, kr_cost, us_value, us_cost, usdkrw, backfilled INTEGER)`, `fx_daily(day TEXT PK, usdkrw)`
- 환율: `FHKST03030100`, `FID_COND_MRKT_DIV_CODE=X`, `FID_INPUT_ISCD=FX@KRW`(실제 호출 확인). 하루 한 시점만 저장, `?refresh=true`일 때 다시 받음.
- 시세가 없으면 평가값은 null. **값을 지어내지 않는다.** 브리핑 숫자는 자료에서만 계산한다.

## Review Focus
1. **컴퓨터가 며칠 꺼져 있었음** → 빈 거래일을 일봉으로 채우고 `backfilled=1`, 휴장일은 건너뜀. (Task 3)
2. **종가·환율 일부 실패** → 그 값만 null, 다음에 다시 시도, 전체를 망치지 않음. (Task 3)
3. **전량 매도·보유 없음** → 평단가 규칙 평가 안 함(잘못 울리지 않음). (Task 4)
4. **원화·달러 혼합** → 통화별 합과 환산 합이 섞이지 않음. (Task 1, 3)
5. **보유 없는 사용자의 브리핑** → 구역이 빠지고 빠진 항목으로 세지 않음. (Task 5)

---

### Task 1: 평가 계산과 환율
**Files:** `portfolio/valuation.py`, `market/fx.py`, `api/routes/market.py`, `api/routes/holdings.py` / Test `tests/portfolio/test_valuation.py`
- `value_of(total, avg, price) -> {value, cost, pl, pl_pct}`, `GET /portfolio/summary` → 통화별 합 + 원화 환산, `GET /market/fx?refresh=`
- [ ] 테스트(실패 확인): 15주·평단 64,000·현재가 71,400 → 1,071,000 / 960,000 / +111,000 / +11.56%, 시세 null, 평단 null, 환율 캐시와 refresh, 환율 실패
- [ ] 구현 → 커밋 `feat(portfolio): 평가금액과 환율`

### Task 2: 조회 주기 설정과 종목 일봉
**Files:** `store/settings.py`, `api/routes/symbols`(기존 위치), 스냅샷 / Test
- 설정: `quotes.refresh_sec` (30, 60, 300, 600, 1800, 3600, 기본 600), `holdings.sync_minutes`(core/holdings에 있으면 재사용). `SettingDef`가 정수 선택지를 검사하게 한다.
- `GET /symbols/{market}/{code}/bars?range=1m|3m|1y` → `[{day, close}]`. 기존 `refresh_bars`, `BarRepo` 재사용, 키 없으면 빈 목록.
- [ ] 테스트(실패 확인): 잘못된 값 422, 기간별 개수, 없는 종목, 키 없음, 미국
- [ ] 구현 → 커밋 `feat(portfolio): 조회 주기와 종목 일봉`

### Task 3: 자산 추이 기록
**Files:** `portfolio/daily.py`, routes / Test `tests/portfolio/test_daily.py`
- 16:00 KST 뒤 첫 확인 때 그날 기록, 기록 전 보유 1회 동기화. 빈 거래일은 마지막 보유 수량 × 그날 종가, 그날 환율로 채운다. 첫 연결 전은 만들지 않는다.
- `GET /portfolio/history?range=1m|3m|1y|all&view=all|krw|usd` → `[{day,value,cost,usdkrw,backfilled}]`
- [ ] 테스트(실패 확인): 하루 1번, 재실행 멱등, 빈 날 채움, 주말·휴장 건너뜀, 종가 실패, 환율 없으면 all에서 null, krw/usd 보기
- [ ] 구현 → 커밋 `feat(portfolio): 자산 추이 기록`

### Task 4: 평단가 알림
**Files:** `alerts/rules.py`, `alerts/monitor.py`, `api/routes/alerts.py` / Test `tests/alerts/`
- 새 종류 `avg_price_pct`: `pct`(0<, ≤100), `direction`(up/down), realtime. 평단가는 `GET /holdings/symbol`과 같은 합산값.
- [ ] 테스트(실패 확인): −10% 도달 시 1회 발생(거짓→참, 하루 1번), 보유 없음·평단 없음은 평가 안 함, 일괄 적용 허용, 스냅샷 추가만
- [ ] 구현 → 커밋 `feat(alerts): 평단가 기준 알림`

### Task 5: 브리핑 개인화
**Files:** `briefing/collect.py`, 스키마 / Test `tests/briefing/`
- 자료에 `my_assets: {change_krw, change_pct, top:{code,name,amount}, bottom:{...}}`. AI 문장에는 숫자를 넣지 않는 기존 규칙 유지.
- [ ] 테스트(실패 확인): 기여 최대·최소, 보유 없으면 키 없음과 `missing` 제외, 전일 기록 없음
- [ ] 구현 → 커밋 `feat(briefing): 내 자산 구역`
