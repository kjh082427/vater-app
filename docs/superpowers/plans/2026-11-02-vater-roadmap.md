# Vater 구현 로드맵

> 브랜치별 구현 계획의 목차입니다. 상세 계획은 브랜치마다 따로 쓰고, **해당 브랜치를 시작할 때** 앞선 브랜치의 실제 코드와 검증 실험 결과를 반영해 작성합니다.

**스펙:** `docs/superpowers/specs/2026-11-02-vater-mvp-design.md`

## 실행 순서

| 순서 | 단계 | 브랜치 | 계획 파일 | 시작 조건 | 완료 조건 |
|---|---|---|---|---|---|
| 1 | 2 | `spike/tradingagents-local-llm` | [2026-11-02-spike-tradingagents-local-llm.md](2026-11-02-spike-tradingagents-local-llm.md) | 1단계 완료 | `REPORT.md`에 S1~S8 결론 기록, 스펙·카탈로그 반영 |
| 2 | 3 | `core/foundation` | [2026-11-02-core-foundation.md](2026-11-02-core-foundation.md) | 1단계 완료 (검증 실험 결과와 무관) | 사이드카가 실행되고, 인증, 저장, 비밀키, SSE, 로그, CI가 통과 |
| 3 | 3 | `core/kis` | 브랜치 시작 시 작성 | `core/foundation` merge | 토큰, 시세 REST, WebSocket, 호출 제한, 종목 마스터 |
| 4 | 3 | `core/llm` | 브랜치 시작 시 작성 | 검증 실험 완료, `core/foundation` merge | 하드웨어 감지, Ollama 관리, 카탈로그, 프리셋 |
| 5 | 3 | `core/analysis` | 브랜치 시작 시 작성 | `core/llm` merge | 분석 큐, 진행 스트리밍, 리포트 저장 |
| 6 | 3 | `core/alerts` | 브랜치 시작 시 작성 | `core/kis` merge | 지표, 규칙 평가, 장 운영 시간, 알림 이벤트 |
| 7 | 3 | `core/briefing` | 브랜치 시작 시 작성 | `core/kis`, `core/llm` merge | 수집, 해석, 일정, 놓친 브리핑 처리 |
| 8 | 4 | `shell/tauri` | 브랜치 시작 시 작성 | 3단계 완료 | 사이드카 수명 관리, 트레이, 알림, Windows CI 빌드 |
| 9 | 4 | `ui/design-system` | 브랜치 시작 시 작성 | 3단계 완료 | 토큰, 공통 컴포넌트, PRODUCT.md, DESIGN.md |
| 10 | 4 | `ui/screens` | 브랜치 시작 시 작성 | `ui/design-system`, `shell/tauri` merge | 9-2의 모든 화면, Playwright 흐름 테스트 |
| 11 | 5 | `infra/release` | 브랜치 시작 시 작성 | 4단계 완료 | 서명된 업데이트, 설치 파일, 릴리스 |

- **계획 파일의 위치:** 1단계에 쓴 계획(이 로드맵, 검증 실험, `core/foundation`)은 main에 커밋합니다. 그 뒤의 계획은 **해당 브랜치의 첫 커밋**으로 넣어, 계획과 코드가 같은 PR에 함께 남게 합니다.

## 사용자 입력이 필요한 지점

| 언제 | 무엇 | 없으면 |
|---|---|---|
| 검증 실험 Task 1 | **Windows에 Ollama 설치** ([ollama.com/download](https://ollama.com/download), 관리자 권한 불필요) | S1~S6 실행 불가. S7(Windows 빌드)은 진행 가능 |
| 검증 실험 Task 6, `core/llm` | 클라우드 LLM API 키 1개 (Claude, OpenAI, Gemini 중) | S8을 "보류"로 기록하고 진행 |
| `core/kis` 실연동 확인 | 한투 appkey, appsecret, HTS ID를 루트 `.env`에 사용자가 직접 입력 (채팅이나 `!` 명령 사용 금지: 명령 내용이 대화 기록에 남음) | 녹화된 응답 기반 테스트만 진행, 실연동 확인은 보류 |
| `ui/design-system` | 디자인 방향 검토 (taste-skill과 impeccable이 제안한 방향 중 선택) | Claude가 추천안으로 진행하고 PR에서 검토 |

## 단계 완료 태그
- `stage-1-design`: 스펙과 이 로드맵, 첫 두 계획을 main에 올린 시점
- `stage-2-spike`, `stage-3-sidecar`, `stage-4-shell-ui`, `stage-5-release`
