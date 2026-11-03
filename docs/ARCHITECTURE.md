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
| AI 분석 | `sidecar/src/vater_core/analysis` (+ `api/routes/analyses.py`) | `core/analysis` | [#5](https://github.com/kjh082427/vater-app/pull/5) | TradingAgents 실행(체크포인트, 진행 스트리밍), 작업 큐, 국내 데이터 공급자 `kis`, 결정 배지·3줄 요약 |
| 알림 | `sidecar/src/vater_core/alerts` (+ `api/routes/{watchlist,alerts}.py`, `store/migrations/003_daily_bars.sql`) | `core/alerts` (+ `-throttle-test`, `-session-bounds`, `-live-wait`) | [#6](https://github.com/kjh082427/vater-app/pull/6), [#7](https://github.com/kjh082427/vater-app/pull/7), [#9](https://github.com/kjh082427/vater-app/pull/9), [#11](https://github.com/kjh082427/vater-app/pull/11) | 알림 규칙 종류·기본값, 지표 계산, 상태 전이·하루 1번 쿨다운, **장 운영 시간(수능날 등 `KR_SPECIAL_HOURS`)**·휴장일, 실시간·폴링 감시, 마감 평가 |
| 일일 브리핑 | `sidecar/src/vater_core/briefing` (+ `api/routes/briefings.py`) | `core/briefing` (+ `-session-bounds`, `-kr-index-closes`) | [#8](https://github.com/kjh082427/vater-app/pull/8), [#10](https://github.com/kjh082427/vater-app/pull/10), [#14](https://github.com/kjh082427/vater-app/pull/14) | 브리핑 시각·놓친 브리핑 규칙, 수집 항목, AI 프롬프트(숫자 금지)·해석 형식, 부분 실패 처리 |
| 데스크톱 셸 | `apps/desktop/src-tauri` | `shell/tauri` | — | 트레이, 알림 표시, 자동 실행, 사이드카 관리 |
| 디자인 시스템 | `apps/desktop/src/design-system` | `ui/design-system` | — | **색, 글꼴, 버튼 같은 겉모양** |
| 화면 | `apps/desktop/src/screens` | `ui/screens` | — | **화면 배치와 흐름** |
| 배포 | `.github/workflows`, `packaging/` | `infra/release` | — | 설치 파일, 자동 업데이트 |
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
