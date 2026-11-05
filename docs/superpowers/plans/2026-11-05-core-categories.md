# core/categories 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 한국·미국 종목의 대·중 분류표를 만들어 앱에 넣고, 탐색·키워드 검색 API를 만든다.

**Architecture:** 개발용 `sidecar/tools/build_categories.py`가 공개 자료를 받아 `vater_core/categories/catalog.json`을 만든다. 직접 관리하는 파일은 `tools/categories/{groups.json, sic_map.json, themes.json}`이다. 앱은 파일만 읽는다(`importlib.resources`, PyInstaller `--collect-data`에 이미 포함).

**Spec:** v2 설계 11장.

## Global Constraints
- 라벨 `area:core`. WICS·GICS 금지.
- **KRX 자료를 내려받거나 가공하지 않는다(스펙 11장).** 앱은 SEC를 부르지 않는다. SEC 요청은 루트 `.env`의 `SEC_USER_AGENT`(값 출력 금지), 초당 10회 이하. `.env.example`에 이름을 더한다.
- 테마 26개는 스펙 11장 그대로.
- 생성 파일 크기 2MB 이하를 테스트로 지킨다.

## Review Focus
1. **새 상장 종목·분류 없는 종목** → "미분류"이고 이름 검색은 된다. (Task 2)
2. **통합에서 코드가 같은 종목** → market + code로 구별. (Task 2)
3. **테마 파일의 종목이 상장 폐지됨** → 종목 마스터에 없으면 목록에서 뺀다. (Task 2)
4. **테마 키워드**("반도체 소켓") → `themes.json`의 키워드로 찾힌다. (Task 2)
5. **SIC 없는 ETF·SPAC** → 미분류, 생성이 멈추지 않는다. (Task 1)

---

### Task 1: 이용 조건 확인과 분류표 생성
**Files:** `tools/build_categories.py`, `tools/categories/*`, `categories/catalog.json`, `docs/TOOLING.md` / Test `tests/categories/test_catalog.py`
- **먼저 SEC 자료 이용 조건을 확인한다.** 재배포가 막히면 멈추고 사용자에게 알린다.
- 입력: 직접 작성한 `groups.json`(대분류 10~15개 → 테마), `themes.json`(테마별 국내·미국 종목과 키워드), `sic_map.json`(SIC→테마 또는 미국 중분류), SEC `company_tickers.json` + `submissions/CIK*.json`(sic, sicDescription).
- 테마 초안은 공개된 사실로 작성하고 **검수 표를 받은 뒤** 커밋한다. 표는 저장소에 새 문서로 만들지 않는다.
- [ ] 테스트(실패 확인): 삼성전자·SK하이닉스·리노공업 ∈ 반도체, HD현대중공업 ∈ 조선, 셀트리온 ∈ 바이오, 농심 ∈ 식품, NVDA ∈ 반도체, MRNA ∈ 바이오, 모든 테마에 한국 또는 미국 종목 존재, 크기 2MB 이하, 테마 26개
- [ ] 구현 → 커밋 `feat(categories): 분류표 생성`

### Task 2: 탐색·검색 API
**Files:** `categories/service.py`, `api/routes/categories.py`, 스냅샷 / Test `tests/api/test_categories_api.py`
- `GET /categories` → 트리, `GET /categories/stocks?node=&market=KR|US|ALL`(기본 ALL, 하위 전체, 종목 마스터와 맞춰 상장 폐지 제외), `GET /categories/search?q=&market=` → 분류 이름과 테마 키워드 일치
- [ ] 테스트(실패 확인): 대분류 선택 = 아래 중분류 합집합, 시장 필터, 빈 결과, 미분류, 이름·테마 키워드, 한 종목이 여러 분류, 중복 제거
- [ ] 구현 → 커밋 `feat(categories): 분류 탐색과 검색 API`
