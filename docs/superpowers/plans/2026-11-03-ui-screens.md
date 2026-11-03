# ui/screens 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 스펙 9-2의 모든 화면(첫 실행 마법사, 홈, 분석, 감시·알림, 브리핑, 설정)을 디자인 시스템(B 리서치 노트) 부품으로 만들고, 사이드카 API·SSE와 Tauri 셸에 연결한다.

**Architecture:**
- `apps/desktop/src/`
  - `api/`: OpenAPI 명세(`sidecar/tests/snapshots/openapi.json`)에서 만든 타입(`schema.d.ts`, `npm run gen:api`, `openapi-typescript`), 토큰을 붙이는 fetch 클라이언트(오류는 `{code, message, hint}`), SSE 허브(`EventSource` + `?token=`, 끊기면 다시 연결), 자료 훅(`useResource`: 불러오기·다시 불러오기·SSE로 무효화)
  - `platform/`(스펙 9-3): `getSidecarInfo()`, `onSidecarState()`, `onNavigate()`, `getAutostart()/setAutostart()`. Tauri 안에서는 `@tauri-apps/api`의 `invoke`/`listen`, 브라우저(Vite 개발 서버)에서는 `VITE_SIDECAR_URL`/`VITE_SIDECAR_TOKEN` 환경변수와 빈 이벤트. 화면은 이 어댑터만 쓴다
  - `app/`: 해시 라우터(의존성 없음), 앱 틀(`AppShell` + 사이드바 + 상태 표시줄 + 오프라인 배너), 오류 경계
  - `screens/<화면>/`: 화면별 폴더(컴포넌트 + 테스트)
- 숫자 표기·색·부품은 모두 `design-system`에서 가져온다(새 색 금지). 시세 방향이 아닌 부호 숫자는 `tone="neutral"`, 미니 차트는 옆 숫자와 같은 자료의 `direction`을 넘긴다(DESIGN.md Do 목록).

**Tech Stack:** React 18 + TypeScript(strict), 디자인 시스템, `openapi-typescript`(개발 의존성), `@tauri-apps/api`(2.x), MSW(테스트용 사이드카 흉내, 스펙 10장), Vitest + RTL, Playwright(흐름 테스트, 마지막 작업). 새 의존성은 배포 2주가 지난 버전으로 정확히 고정한다.

**Spec:** `docs/superpowers/specs/2026-11-02-vater-mvp-design.md` 9장(화면), 2-1·2-2(셸·통신), 4·5·6장(알림·분석·브리핑 내용), 10장(UI 테스트). 디자인 규칙: `DESIGN.md`.

## 선행 조건 (다른 영역 브랜치)
- `core/alerts-watch-quotes`(리뷰 중): `GET /watchlist/quotes`, SSE `quote`, 상태의 `markets`·`feeds` → 홈 감시 종목과 상태 표시줄
- `core/alerts-rule-preview`(새로 작게): `POST /alerts/rules/preview {watchlist_id, kind, params, timing}` → `{state, value, message}` → 규칙 편집기의 "미리보기: 현재 지표값"
- `shell/tauri`(진행 중): `get_sidecar_info` → `{state, port?, token?}`, 이벤트 `sidecar-state`, `navigate {route}`, `set_autostart/get_autostart`

## Global Constraints
- 브랜치 `ui/screens`, 폴더 `apps/desktop/src/{api,platform,app,screens}`. 라벨 `area:ui`. 디자인 시스템 부품을 고쳐야 하면 `ui/design-system-*` 브랜치에서 한다(영역 규칙).
- 라우트(알림 클릭 경로와 맞춤): `#/home`, `#/analyses`, `#/analyses/:id`(분석 완료 알림), `#/alerts`, `#/symbols/:market/:code`(가격 알림 → 그 종목의 감시·알림, 스펙 9-3), `#/briefings`, `#/briefings/:id`(브리핑 알림), `#/settings`, `#/welcome`(마법사).
- 첫 실행 마법사는 한투 키(`GET /secrets`의 `KIS_APP_KEY`)가 없으면 연다. 키 값은 화면 어디에도 다시 보이지 않는다(쓰기 전용).
- 면책 문구: 분석 결과·브리핑 화면마다(스펙 5장, 9-1). 분석은 "결론이 달라질 수 있음"도.
- 분석 진행 단계는 `analysts → research → trader → risk → portfolio`만 보인다(`other`는 숨김, 3단계 확인 때 발견).
- 오프라인 배너: `alerts.state`가 `offline`이거나 SSE가 끊겼을 때. 사이드카가 재시작되면(`sidecar-state`) 포트·토큰을 다시 읽고 SSE를 다시 연결한다.
- 모든 금액은 디자인 시스템 표기 함수로(원·달러·억), 표의 금액 열은 머리에 단위.

## Review Focus
1. **사이드카가 재시작되어 포트·토큰이 바뀜** → 화면이 멈추지 않고 다시 연결된다. (Task 1)
2. **SSE가 끊김** → 오프라인 배너, 다시 연결되면 사라지고 목록을 다시 불러온다. (Task 1)
3. **API 오류 응답 `{code, message, hint}`** → 화면이 `message`와 `hint`를 그대로 보여 준다(키 없음, 바쁨, 세션 없음 등). (Task 1, 각 화면)
4. **빈 상태**(감시 종목 0개, 브리핑 없음, 분석 이력 없음, 시세 null) → 무엇을 하면 되는지 알려 주는 빈 화면. (각 화면)
5. **숫자의 단위·색 실수**(퍼센트를 비율로, 수급 0억) → 디자인 시스템 표기 함수만 쓰고 테스트로 확인. (각 화면)

---

### Task 1: 공용 기반 (API 타입·클라이언트·SSE·플랫폼·라우터·앱 틀)
- `npm run gen:api` → `src/api/schema.d.ts`(커밋), `api/client.ts`(`request<T>(path, {method, body})`, 오류는 `ApiError{code, message, hint, status}`), `api/events.ts`(구독: `subscribe(type, handler)`, 끊김·다시 연결 상태), `api/useResource.ts`
- `platform/index.ts`(Tauri/브라우저 구현 둘, 테스트는 브라우저 구현과 Tauri 쪽 `invoke` 흉내)
- `app/router.ts`(해시 파싱·이동), `app/App.tsx`(AppShell, 사이드바 5개, 상태 표시줄 = `alerts.state`의 markets·feeds 요약 + AI 엔진(`/llm/check` 또는 설정의 프리셋), 오프라인 배너, 마법사로 보내기)
- MSW: `src/test/server.ts`(사이드카 흉내, 기본 응답은 OpenAPI 타입을 따른다)
- [ ] 테스트: 토큰 헤더, 오류 변환, SSE 다시 연결과 배너, 사이드카 재시작 뒤 새 포트로 요청, 해시 라우트 9개, `navigate` 이벤트로 이동, 키 없으면 마법사 → 커밋 `feat(ui): API 클라이언트·SSE·플랫폼 어댑터·라우터·앱 틀`

### Task 2: 홈
- 최근 브리핑 카드(국내·미국 탭, 한 줄 요약 `AiText`, 지수 표 + `Sparkline`(closes, 방향 = 그날 등락), "브리핑 읽기"), 감시 종목(`/watchlist/quotes` + SSE `quote`, 현재가·전일 대비·등락률·수신 상태 `FeedStatus`), 최근 알림 5개(`/alerts/events?limit=5` + `alert.fired`), 진행 중인 분석(`analysis.status`/`analysis.progress`)
- [ ] 테스트: 각 영역 정상·빈 상태·오류, SSE로 시세·알림이 바뀜, 가격 null이면 "—"와 "데이터 없음" → 커밋 `feat(ui): 홈`

### Task 3: 감시·알림
- 감시 종목 추가(종목 검색 `/symbols/search`)·삭제, 종목별 규칙 목록, 규칙 편집기(종류 `/alerts/kinds` → 파라미터 폼(필수·기본값) → 확인 시점 → 미리보기 `POST /alerts/rules/preview`), 켜기·끄기, 알림 이력(`/alerts/events`, 종목·종류 필터), `#/symbols/:market/:code`는 그 종목을 펼친 상태, 감시 일시 중지·재개
- [ ] 테스트: 추가·중복(409)·삭제, 규칙 만들기·검증 오류(422의 hint 표시)·수정·삭제, 미리보기 값, 필터, 알림 클릭 경로 → 커밋 `feat(ui): 감시·알림`

### Task 4: 분석
- 새 분석(종목 검색, 기준일, 프리셋), 진행 타임라인(5단계, 단계별 시간, 취소), 결과(의견 눈금 `DecisionScale`, 3줄 요약, 목표가·기간, 에이전트별 탭(보고서 원문), 실행 정보(모델·시간·토큰), 면책 + "결론이 달라질 수 있음"), 실패(오류 메시지·hint, 다시 시도 = 체크포인트로 이어서), 이력(종목별, 결정 바뀜 표시)
- [ ] 테스트: 제출 → 진행 SSE → 완료, 취소, 실패 → 다시 시도, `other` 단계 숨김, 결정 6종 표시 → 커밋 `feat(ui): 분석`

### Task 5: 브리핑
- 날짜·시장별 목록(상태 done/partial, 빠진 항목 표시), 상세(AI 문장 6개 `AiText` + 데이터 표·미니 차트: 지수·업종(상승·하락 수)·상위 종목·수급(억, 순매수 빨강)·내 감시 종목·그날 알림), 해석이 없으면 "AI 해석 없음(데이터만)", "지금 만들기"(202, 409 BUSY/NO_SESSION 메시지)
- [ ] 테스트: 국내·미국 상세, partial, 지금 만들기 흐름과 오류 → 커밋 `feat(ui): 브리핑`

### Task 6: 설정
- 한투(앱키·시크릿·HTS ID 쓰기 전용 입력, 실전/모의, 연결 테스트 `/settings/kis/test`), AI 엔진(프리셋, 클라우드 제공자·키·모델·연결 테스트, 로컬: 하드웨어 등급·추천 모델·Ollama 상태·설치·모델 받기 진행률(SSE `llm.pull`/`llm.install`)·삭제), 분석 기본값(토론 라운드), 브리핑(시각, 시장 켜기·끄기), 일반(부팅 시 자동 실행 = 플랫폼, 버전 `/health`)
- [ ] 테스트: 키 저장 뒤 값이 다시 보이지 않음, 설정 검증 오류, 연결 테스트 성공·실패, 모델 받기 진행률 → 커밋 `feat(ui): 설정`

### Task 7: 첫 실행 마법사
- ① 환영·면책 → ② 한투 연결(키 입력, 실전/모의, 연결 테스트) → ③ AI 엔진(클라우드 키 / 로컬 설치(하드웨어 결과, 추천 모델, 진행률) / 나중에) → ④ 감시 종목 추가(선택) → ⑤ 완료(부팅 시 자동 실행, 기본 켬). 성공 기준 1: 10분 안에 마침
- [ ] 테스트: 단계 이동·뒤로, 연결 테스트 실패 시 다음으로 못 감(건너뛰기는 허용 안 함), AI "나중에", 완료 뒤 홈 → 커밋 `feat(ui): 첫 실행 마법사`

### Task 8: 흐름 테스트(Playwright)와 마무리
- Vite 개발 서버 + 개발 모드 사이드카(`VATER_DEV=1`, 임시 데이터 폴더, 종목 마스터 대신 심어 둔 종목)로: 마법사(가짜 키 → 연결 테스트 실패 메시지), 감시 종목·규칙 만들기 → 목록·이력, 브리핑 목록 빈 상태, 설정 저장. 브라우저는 WSL Chromium(`npx playwright install chromium`, 안 되면 Windows Chrome에 CDP로)
- impeccable critique·audit, 화면 캡처(1280×800, 1024×600, 배율 1.5) → 고침, README, `docs/ARCHITECTURE.md` 화면 행
- [ ] 커밋 `test(ui): 화면 흐름 테스트와 마무리`
