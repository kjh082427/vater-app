# 구조 지도

앱의 각 영역이 **어느 폴더**에 있고, **어느 브랜치/PR**에서 만들어졌으며, **고치면 무엇이 바뀌는지** 정리한 문서입니다.
브랜치가 merge될 때마다 갱신합니다. 상세 설계는 [설계 스펙](superpowers/specs/2026-11-02-vater-mvp-design.md)을 보세요.

## 한눈에 보기

```
Vater.exe (Tauri 셸) ── React UI ──HTTP/SSE──► vater-core (Python 사이드카) ──► 한국투자증권 API
        │                                          │                         ──► Yahoo 등 (TradingAgents)
        └──── Windows 알림 ◄── stdout 이벤트 ───────┘                         ──► 클라우드 LLM / Ollama
```

## 영역별 지도

| 영역 | 폴더 | 브랜치 | PR | 여기를 고치면 |
|---|---|---|---|---|
| 기반 (API, 저장, 비밀키, 로그) | `sidecar/src/vater_core/{api,store,secrets}`, `__main__.py`, `logging_setup.py` | `core/foundation` | [#1](https://github.com/kjh082427/vater-app/pull/1) | API 인증, 오류 형식, DB 구조, 설정 항목, 키 저장 방식, 로그 마스킹 |
| 한국투자증권 연동 | `sidecar/src/vater_core/kis` (+ `api/routes/kis.py`, `store/migrations/002_symbols.sql`) | `core/kis` (+ `-index-daily`) | [#2](https://github.com/kjh082427/vater-app/pull/2), [#13](https://github.com/kjh082427/vater-app/pull/13) | 토큰 캐시, 호출 제한, 시세·재무·뉴스·시장 데이터, 실시간 체결, 종목 검색. 실연동 사실은 `docs/kis-live-findings.md` |
| LLM 관리 | `sidecar/src/vater_core/llm` (+ `api/routes/llm.py`) | `core/llm` | [#4](https://github.com/kjh082427/vater-app/pull/4) | 하드웨어 등급, 모델 카탈로그(`catalog.json`), Ollama 상태·설치·모델 받기, 프리셋 → TradingAgents 설정, 클라우드 키 테스트 |
| AI 분석 | `sidecar/src/vater_core/analysis` (+ `api/routes/analyses.py`) | `core/analysis` (+ `-retry`) | [#5](https://github.com/kjh082427/vater-app/pull/5), [#35](https://github.com/kjh082427/vater-app/pull/35) (무료 Gemini 재시도와 대체 모델, `analysis/fallback.py`) | TradingAgents 실행(체크포인트, 진행 스트리밍), 작업 큐, 국내 데이터 공급자 `kis`, 결정 배지·3줄 요약 |
| 알림 | `sidecar/src/vater_core/alerts` (+ `api/routes/{watchlist,alerts}.py`, `store/migrations/003_daily_bars.sql`) | `core/alerts` (+ `-throttle-test`, `-session-bounds`, `-live-wait`, `-watch-quotes`, `-rule-preview`, `-kis-auth`) | [#6](https://github.com/kjh082427/vater-app/pull/6), [#7](https://github.com/kjh082427/vater-app/pull/7), [#9](https://github.com/kjh082427/vater-app/pull/9), [#11](https://github.com/kjh082427/vater-app/pull/11), [#16](https://github.com/kjh082427/vater-app/pull/16), [#17](https://github.com/kjh082427/vater-app/pull/17), [#23](https://github.com/kjh082427/vater-app/pull/23) | 알림 규칙 종류·기본값, 지표 계산, 상태 전이·하루 1번 쿨다운, **장 운영 시간(수능날 등 `KR_SPECIAL_HOURS`)**·휴장일, 실시간·폴링 감시, 마감 평가, 홈 화면 시세(`GET /watchlist/quotes`, SSE `quote`)·종목별 수신 상태, 규칙 미리보기 |
| 일일 브리핑 | `sidecar/src/vater_core/briefing` (+ `api/routes/briefings.py`) | `core/briefing` (+ `-session-bounds`, `-kr-index-closes`) | [#8](https://github.com/kjh082427/vater-app/pull/8), [#10](https://github.com/kjh082427/vater-app/pull/10), [#14](https://github.com/kjh082427/vater-app/pull/14) | 브리핑 시각·놓친 브리핑 규칙, 수집 항목, AI 프롬프트(숫자 금지)·해석 형식, 부분 실패 처리 |
| 대시보드 API | `sidecar/src/vater_core/{store/dashboards.py,market/}` (+ `api/routes/{ui,market}.py`) | `core/ui-dashboards` | [#20](https://github.com/kjh082427/vater-app/pull/20) | 홈 대시보드 배치 문서 저장(`GET/PUT /ui/dashboards`, 모양만 검사), 지수 현재값·30거래일 종가(`GET /market/indices`, 30초 캐시) |
| 증권사 보유 내역 | `sidecar/src/vater_core/{brokers,holdings}`, `store/holdings.py`, `store/migrations/004_holdings.sql` (+ `api/routes/holdings.py`) | `core/holdings`, `core/broker-kis`, `core/broker-kiwoom`, `core/broker-meritz` | [#28](https://github.com/kjh082427/vater-app/pull/28), [#29](https://github.com/kjh082427/vater-app/pull/29), [#30](https://github.com/kjh082427/vater-app/pull/30), [#31](https://github.com/kjh082427/vater-app/pull/31) | 연결(증권사 + 계좌), 동기화와 종목별 합산, 연결 해제와 다시 연결, 수동 입력, CSV 가져오기, 허용 목록 HTTP(`ReadOnlyHttp`). 설계 `docs/superpowers/specs/2026-11-05-v2-design.md` |
| 분류로 종목 찾기 | `sidecar/src/vater_core/categories` (`catalog.json`, `service.py`), `sidecar/tools/{build_categories.py,categories/}` (+ `api/routes/categories.py`) | `core/categories` | (PR 전) | 대분류 10개 → 중분류(테마 26개 + 미국 전용), 시장 선택(한국·미국·통합), 키워드 검색, 미분류. 분류표는 SEC SIC와 직접 작성한 테마 파일로 개발 때 생성하고 앱은 파일만 읽는다. 거래소(KRX) 자료는 쓰지 않는다. 설계 v2 11장 |
| 평가와 자산 추이 | `sidecar/src/vater_core/portfolio`, `market/fx.py` (+ `api/routes/portfolio.py`, `store/migrations/006_portfolio.sql`) | `core/portfolio` | [#33](https://github.com/kjh082427/vater-app/pull/33) | 평가금액, 환율, 자산 추이, 평단가 알림, 브리핑 내 자산. 개인정보를 AI로 보내지 않는 검사 `sidecar/tests/test_no_personal_data_to_ai.py` |
| 분류 탐색 | `sidecar/src/vater_core/categories`, `sidecar/tools/build_categories.py` (+ `api/routes/categories.py`) | `core/categories` | [#32](https://github.com/kjh082427/vater-app/pull/32) | 대·중 분류표(직접 작성한 테마 + SEC SIC), 탐색과 검색 API. KRX 자료는 쓰지 않는다 |
| 데스크톱 셸 | `apps/desktop/src-tauri` | `shell/tauri` (+ `-acceptance`, `-open-log-folder`) | [#18](https://github.com/kjh082427/vater-app/pull/18), [#22](https://github.com/kjh082427/vater-app/pull/22), [#24](https://github.com/kjh082427/vater-app/pull/24) | 트레이, 알림 표시, 자동 실행, 사이드카 관리(재시작 10분 3회, 준비 대기 60초, Windows 작업 개체로 함께 종료). Windows CI `.github/workflows/desktop.yml` |
| 디자인 시스템 | `apps/desktop/src/design-system` (+ `apps/desktop` 뼈대: `package.json`, `vite.config.ts`, `gallery.html`) | `ui/design-system` (+ `-dashboard`) | [#15](https://github.com/kjh082427/vater-app/pull/15), [#21](https://github.com/kjh082427/vater-app/pull/21) (대시보드 라이트) | **색, 글꼴, 버튼 같은 겉모양**, 숫자 표기(`format/money.ts`). 규칙은 저장소 루트 `DESIGN.md`, 견본은 `gallery.html` |
| 화면 | `apps/desktop/src/{api,platform,app,dashboard,screens,mocks}`, `apps/desktop/e2e` (+ `mock.html`, `playwright.config.ts`) | `ui/screens` (+ `ui/dashboard`, `ui/acceptance`) | [#19](https://github.com/kjh082427/vater-app/pull/19) (1차 초안), [#25](https://github.com/kjh082427/vater-app/pull/25) (대시보드), [#26](https://github.com/kjh082427/vater-app/pull/26) (4단계 화면 확인 U1~U16, `apps/desktop/e2e/acceptance`), [#34](https://github.com/kjh082427/vater-app/pull/34) (v2 보유 내역, 분류 탐색, 칸 교체, 브랜치 `ui/holdings`) | **화면 배치와 흐름**: 사이드카 API 타입(OpenAPI → `schema.d.ts`)·클라이언트·SSE 허브, 셸 어댑터(`platform/`), 해시 라우터와 앱 틀, 홈·분석·감시·알림·브리핑·설정·첫 실행 마법사, MSW 사이드카 흉내, 실제 개발 모드 사이드카와의 흐름 테스트(Playwright). 남은 일은 `apps/desktop/README.md`. 홈은 사용자가 짜는 대시보드 탭(`src/dashboard`, 브랜치 `ui/dashboard`, 설계 `docs/superpowers/specs/2026-11-03-dashboard-design.md`) |
| 배포 | `.github/workflows/release*.yml`, `apps/desktop/src-tauri/packaging/`, `src-tauri/src/updater.rs` | `infra/release` (+ `-0.2`) | [#27](https://github.com/kjh082427/vater-app/pull/27), [#37](https://github.com/kjh082427/vater-app/pull/37) (v0.2.0) | 태그 → 서명된 설치 파일과 `latest.json`을 공개 저장소 `vater-releases`에 올림, 앱 자동 업데이트, 설치 안내 `docs/INSTALL.md` |
| 3단계 확인 테스트 | `sidecar/tests/acceptance` (계획 `docs/superpowers/plans/2026-11-03-stage-3-acceptance.md`) | `core/acceptance` | [#12](https://github.com/kjh082427/vater-app/pull/12) | 사이드카 전체를 실제 흐름대로 확인(프로세스 수명, 알림 지연 5초/60초, 끊김·오프라인 복구, 분석·브리핑 → 이력). 기능을 바꾸면 여기도 통과해야 한다 |
| 검증 실험 | `spikes/` | `spike/tradingagents-local-llm` | [#3](https://github.com/kjh082427/vater-app/pull/3) | (앱 코드 아님) 결과는 `spikes/tradingagents-local-llm/REPORT.md` |

## 브랜치 의존 관계

```
core/foundation ─┬─► core/kis ──┬─► core/alerts
                 │              └─► core/briefing ◄─┐
                 └─► core/llm ────► core/analysis   │
                          └─────────────────────────┘
core/* ─(OpenAPI → TS 타입)─► ui/screens ◄── ui/design-system
core/* ─(PyInstaller)───────► shell/tauri ──► infra/release
```

## 규칙
- 앱 영역 1개 = 브랜치 1개 = 폴더 1개.
- PR은 merge 커밋으로 합치고, 브랜치는 지우지 않습니다.
- 나중에 수정할 때는 같은 접두어로 새 브랜치를 만듭니다 (예: `ui/redesign-v2`).
