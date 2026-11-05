# core/holdings 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 증권사·연결·보유 내역의 공통 틀과 API를 만든다. 어댑터 규격, 수동 입력, CSV 가져오기, 연결 해제, 주문 금지 장치까지 포함한다. 증권사 코드는 다음 브랜치들이 채운다.

**Architecture:** `store/holdings.py`(DB), `brokers/base.py`(어댑터 규격과 등록), `brokers/readonly.py`(허용 목록 HTTP), `holdings/service.py`(동기화·합산), `holdings/csv_import.py`, `api/routes/holdings.py`. 어댑터는 가짜로 테스트한다.

**Tech Stack:** FastAPI, sqlite3, Decimal, 표준 csv. **새 의존성 없음.**

**Spec:** `docs/superpowers/specs/2026-11-05-v2-design.md` 0, 1, 2, 3, 4-1, 5, 8, 14장

## Global Constraints
- 브랜치 `core/holdings`, 라벨 `area:core`. **주문·정정·취소 없음.**
- 수량·평단가는 Decimal이고 DB에는 문자열로 저장한다(미국 소수점 주식).
- 키·시크릿·계좌번호는 비밀키 저장소에만 둔다. DB·로그·응답에 원문을 남기지 않는다. 응답의 계좌는 `****1234` 형태만.
- 오류는 `VaterError` 형식. 새 코드: `BROKER_AUTH_INVALID`, `BROKER_UNREACHABLE`, `BROKER_UNKNOWN`, `CONNECTION_NOT_FOUND`, `HOLDING_INVALID`, `CSV_INVALID`.
- 새 마이그레이션은 `004_holdings.sql`. 지난 파일은 고치지 않는다.

## Review Focus
1. **증권사별 키가 로그에 남음** → 연결 키도 `known_values()`에 들어가 마스킹된다. (Task 1)
2. **동기화 중 한 곳이 실패** → 그 연결의 기존 보유 내역을 지우지 않고, 나머지는 갱신한다. (Task 4)
3. **응답이 비어 있음(전량 매도 또는 일시 오류의 빈 응답)** → 정상 빈 응답일 때만 수량 0 처리, 오류면 유지. (Task 4)
4. **CP949 CSV, 천 단위 쉼표, 음수·0 수량, 같은 이름 종목 여럿** → 깨지지 않고 행별 이유 표시. (Task 6)
5. **연결 해제 뒤 삭제 안 함·삭제함** → 합계와 "연결 해제됨" 표시가 맞고, 감시 종목은 남는다. (Task 5)

---

### Task 1: 연결별 비밀키
**Files:** `secrets/store.py`, `secrets/names.py` / Test `tests/secrets/`
- `SecretStore.get/set/delete`가 문자열 이름을 받는다(`SecretName`은 `StrEnum`).
- `broker_secret(conn_id: int, field: Literal["APP_KEY","APP_SECRET","ACCOUNT","TOKEN"]) -> str` → `BROKER_{id}_{field}`. 한투 계좌도 이 이름을 쓴다.
- `known_values()`는 고정 이름 + 저장된 연결 이름을 모두 돌려준다. 키링은 목록을 못 주므로 저장소 안의 `BROKER_SECRET_NAMES`에 이름만 적어 둔다(로그 설정이 DB보다 먼저 돌기 때문).
- [ ] 테스트(실패 확인): 두 저장소 모두 동적 이름 저장·삭제, **연결 키 값이 로그 필터에서 가려짐**, `/secrets` API로 동적 이름을 읽거나 쓸 수 없음
- [ ] 구현 → 전체 테스트 → 커밋 `feat(secrets): 증권사 연결별 비밀키`

### Task 2: DB와 증권사 목록
**Files:** `store/migrations/004_holdings.sql`, `store/holdings.py` / Test `tests/store/test_holdings.py`
```sql
brokers(id TEXT PK, name TEXT, color TEXT, kind TEXT CHECK(kind IN ('api','manual')), builtin INTEGER)
connections(id INTEGER PK, broker_id REFERENCES brokers, account_mask TEXT, status TEXT CHECK(status IN ('ok','lost','disconnected')), last_synced_at TEXT, last_error TEXT)
holdings(id INTEGER PK, broker_id, connection_id INTEGER NOT NULL DEFAULT 0, market TEXT, code TEXT, name TEXT, quantity TEXT, avg_price TEXT, currency TEXT, source TEXT CHECK(source IN ('api','manual','csv')), supported INTEGER, updated_at TEXT, UNIQUE(broker_id, connection_id, market, code))
```
- 마이그레이션이 기본 증권사를 넣는다: kis 한국투자 `#7B634F`, meritz 메리츠 `#D14C34`, kiwoom 키움 `#D4467D`(api) / samsung 삼성 `#1C2FA7`, mirae 미래에셋 `#D97A00`(manual). 직접 추가 색 순서: `#2E8B57`, `#138D90`, `#7D3C98`, `#6B8E23`, `#B8860B`, 그 뒤로 반복.
- `HoldingsRepo`: `brokers()`, `add_broker(name)`, `connections()`, `upsert_connection`, `replace_api(conn_id, rows, at)`, `manual_upsert`, `manual_delete`, `delete_broker_data(broker_id)`, `by_symbol(market, code)`, `all()`
- [ ] 테스트(실패 확인): 기본 5개, 이름 중복 거절, 색 순서, 0.1.0 DB에서 올려도 감시 종목·규칙 유지, Decimal 왕복(`0.123456`), UNIQUE 동작, `replace_api`가 응답에 없는 종목을 수량 0으로
- [ ] 구현 → 커밋 `feat(holdings): 증권사·연결·보유 내역 저장`

### Task 3: 어댑터 규격과 주문 금지 장치
**Files:** `brokers/base.py`, `brokers/readonly.py`, `tests/test_readonly_guarantee.py` / Test `tests/brokers/test_readonly.py`
- `BrokerHolding(market: Literal["KR","US"] | None, code, name, quantity: Decimal, avg_price: Decimal | None, currency: str)` (`market=None` = 지원하지 않는 시장)
- `class BrokerAdapter(Protocol): async def test(self) -> None; async def holdings(self) -> list[BrokerHolding]`
- `ADAPTERS: dict[str, Callable[[BrokerCreds, httpx.AsyncClient, SecretStore], BrokerAdapter]]`, `BrokerCreds(conn_id, app_key, app_secret, account)`
- `ReadOnlyHttp(http, allowed: frozenset[tuple[str, str]])`: (메서드, 경로) 허용 목록에 없으면 호출 전에 예외. **어댑터는 이것으로만 HTTP를 부른다.**
- 가드 확장: `brokers/` 안에서 `httpx` 직접 사용 금지(소스 검사), 키움·메리츠 주문 패턴 추가
- [ ] 테스트(실패 확인): 허용 안 된 경로 거절, 키움 `/api/dostk/ordr`·`kt1000x` 패턴을 가드가 잡음, `brokers/`의 `httpx.` 직접 호출 탐지
- [ ] 구현 → 커밋 `feat(brokers): 어댑터 규격과 허용 목록 HTTP`

### Task 4: 연결·동기화 API
**Files:** `holdings/service.py`, `api/routes/holdings.py`, `api/deps.py`, `api/app.py`, 스냅샷 / Test `tests/api/test_holdings_api.py`
- `GET /brokers`, `POST /brokers {name}`, `GET /connections`
- `POST /connections {broker_id, app_key, app_secret, account?}`: `adapter.test()` 통과해야 저장, 실패면 저장 안 함. 한투는 저장된 앱키를 쓰고 `account`만 받는다.
- `POST /holdings/sync {broker_id?}` → 연결별 `{connection_id, ok, error?}`, SSE `holdings.changed`. 인증 오류면 status `lost`.
- `GET /holdings`(증권사·종목 전체), `GET /holdings/symbol/{market}/{code}` → `{total, avg_price, cost, brokers:[{broker_id,name,color,quantity,ratio,stale}]}`. 합산 공식은 스펙 4-1.
- `POST /holdings/watch {items:[{market,code}], rule?:{kind,params}}`: 감시 종목 추가, 이미 있으면 건너뜀, 규칙 일괄 적용. `price_above/below`는 422.
- 앱 시작 때 1회 동기화, `holdings.sync_minutes`(0, 10, 30, 60, 기본 0) 주기, 장중만. `VATER_BACKGROUND_JOBS=0`이면 끔.
- [ ] 테스트(실패 확인): 연결 테스트 실패 시 비밀키 안 남음, 한 곳 실패해도 다른 곳 갱신·기존 내역 유지, 합산 평단가(10주 60,000 + 5주 72,000 → 64,000), 비율 합, 지원 안 되는 시장은 합계 제외, 규칙 일괄 적용, 응답에 키·계좌 원문 없음
- [ ] 구현, 스냅샷, 커밋 `feat(holdings): 연결과 동기화 API`

### Task 5: 연결 해제와 수동 입력
**Files:** 같은 곳 / Test 같은 곳
- `DELETE /connections/{id}?delete_data=true|false`: 비밀키는 항상 삭제. false면 status `disconnected`로 유지. true면 그 연결의 보유 내역 삭제. 감시 종목·규칙·자산 기록은 남긴다.
- `DELETE /brokers/{id}/data`: 수동 증권사의 데이터 삭제.
- `POST/PATCH/DELETE /holdings/manual`: 종목, 증권사, 수량(>0), 평균 매수가(>0) 필수. `api` 증권사에 연결이 있으면 수동 입력 거절.
- [ ] 테스트(실패 확인): 해제 후 키 삭제, 삭제/유지 각각의 합계, 감시 종목 유지, 수동 필수값 422(0, 음수, 빈값), API 동기화가 수동 항목을 지우지 않음
- [ ] 구현 → 커밋 `feat(holdings): 연결 해제와 수동 입력`

### Task 6: CSV 가져오기
**Files:** `holdings/csv_import.py`, routes / Test `tests/holdings/test_csv.py`
- `POST /holdings/csv/preview` (본문 파일, 최대 2MB) → `{columns, guess:{name|code,quantity,avg_price}, rows:[{row,market?,code?,name,quantity,avg_price,error?,candidates?}]}`, `POST /holdings/csv/commit {broker_id, rows}`: 그 증권사의 수동 항목을 교체, 변경 요약 반환
- UTF-8(BOM 포함) 먼저, 실패하면 CP949. 쉼표 금액 처리. 열 이름 후보: 종목명, 종목코드, 보유수량, 잔고수량, 평균단가, 매입단가, 평균매수가
- 이름 검색은 기존 `search_symbols`
- [ ] 테스트(실패 확인): 두 인코딩, 쉼표, 빈 행, 음수·문자 수량 행 오류, 못 찾은 종목, 같은 이름 후보, 2MB 초과, API 증권사 거절, commit이 파일에 없는 수동 항목을 지움
- [ ] 구현 → README, 커밋 `feat(holdings): CSV 가져오기`
