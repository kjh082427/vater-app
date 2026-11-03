# 3단계(사이드카) 확인 테스트 계획

> 사용자 요청(2026-11-03): "각 단계 완료할 때마다 꼼꼼한 테스트 케이스 만들어서 테스트 진행까지 완료해줘."
> 작업별 단위 테스트와 별도로, 3단계 전체를 **실제로 쓰는 흐름대로** 묶어 확인한다. 통과하면 main에 `stage-3-sidecar` 태그.

**Goal:** 사이드카가 스펙 0장 성공 기준 중 3단계 몫(2 알림 지연, 3 분석 완료, 4 브리핑, 6 주문 경로 없음)과 8장 오류 처리를 끝까지 지키는지 확인한다.

**Spec:** `docs/superpowers/specs/2026-11-02-vater-mvp-design.md` 0장(성공 기준), 2장(프로세스·통신·API), 4장(알림), 5장(분석), 6장(브리핑), 7장(한투), 8장(오류)

**위치:** 브랜치 `core/acceptance`, 폴더 `sidecar/tests/acceptance/`. 인터넷이 필요 없는 것은 기본 실행(CI)에 넣고, 실제 키가 필요한 것은 `@pytest.mark.kis_live`/`llm`.

**방식:** 이미 있는 코드를 확인하는 테스트다. 실패하면 그것이 찾은 버그이고, 해당 영역 브랜치에서 실패하는 테스트로 재현해 고친다.

## 테스트 케이스

### A. 프로세스 수명 — 실제 `python -m vater_core` (파일 `test_process.py`)
| # | 시나리오 | 기대 결과 |
|---|---|---|
| A1 | 실행 | stdout 첫 줄 `ready` + 포트, `/health` 200 |
| A2 | 토큰 없음·틀림 | 401, 응답 형식 `{code, message, hint}` |
| A3 | CORS | `tauri://localhost` 허용, 다른 출처 거부 |
| A4 | 정상 종료 | `POST /shutdown` 202 → 10초 안에 종료 코드 0 |
| A5 | 재시작해도 유지 | 감시 종목·규칙·설정이 다시 켠 뒤에도 그대로 |
| A6 | 키는 쓰기 전용 | `PUT /secrets/{name}` 뒤 `GET /secrets`에 이름·설정 여부만, 값 없음. **로그 파일에 키 원문 없음** |
| A7 | SSE | `GET /events?token=`으로 연결 → `POST /alerts/pause` → `alerts.state paused`를 받음 |

### C. 알림 끝까지 — 실제 감시 루프 + 실제 WebSocket 클라이언트 + 가짜 한투 서버 (`test_alerts_flow.py`)
| # | 시나리오 | 기대 결과 |
|---|---|---|
| C1 | API로 감시 종목·규칙을 만들고 실시간 틱이 목표가를 넘음 | **5초 안에** Windows 알림 요청·SSE `alert.fired`·`GET /alerts/events`에 1건 (스펙 성공 기준 2) |
| C2 | 구독 한도를 넘은 종목의 가격이 목표가를 넘음 (폴링 10초) | **60초 안에** 알림 1건 (스펙 성공 기준 2) |
| C3 | 한투 WebSocket이 끊김 → 다시 연결 | 끊긴 동안 모든 종목 폴링(`realtime 0`), 다시 연결되면 실시간으로 돌아옴 |
| C4 | 인터넷 끊김 → 복구 | SSE `alerts.state offline` → 복구 뒤 `running`, 감시 루프는 살아 있음 |
| C5 | 규칙을 만든 순간 이미 조건이 참 | 알림 없음(기준값만) — 실제 소켓 경로에서 다시 확인 |

### D. 분석 → 알림 이력 (`test_events_flow.py`)
| # | 시나리오 | 기대 결과 |
|---|---|---|
| D1 | `POST /analyses`(가짜 엔진) → 완료 | SSE `analysis.status done`, `GET /alerts/events`에 "AI 분석 완료: 삼성전자 — 매수" |
| D2 | 분석 실패 | 이력에 "AI 분석 실패: ..." |

### E. 브리핑 (`test_events_flow.py`)
| # | 시나리오 | 기대 결과 |
|---|---|---|
| E1 | 브리핑 시각이 지남(일정 루프) | `GET /briefings`에 1건(done), 알림 이력 "시장 브리핑 도착", SSE `briefing.status done` |
| E2 | AI 해석 실패 | `partial`, `missing`에 `interpretation`, 그래도 알림 |
| E3 | 장중에 수동 실행 | 409 `BRIEFING_NO_SESSION`(지난 세션을 오늘 숫자로 덮어쓰지 않음) |

### F. 주문 경로 없음
| # | 시나리오 | 기대 결과 |
|---|---|---|
| F1 | 소스 전체 검사 (`tests/test_readonly_guarantee.py`) | 주문·정정·취소 TR ID·경로가 하나도 없음 |
| F2 | API 명세 | 사이드카 API에 주문 관련 경로 없음 |

### G. 실연동 (실제 키, 기본 실행에서 제외)
| # | 시나리오 | 기대 결과 |
|---|---|---|
| G1 | **실제 키로 실제 사이드카 프로세스를 60초**(백그라운드 작업 켬): 종목 마스터 받기, 감시 종목 추가, 국내 장중이면 실시간 구독 | 종목 검색 됨, `alerts/status`가 `running`이고 장중이면 `realtime ≥ 1`, 로그에 키 원문 없음 |
| G2 | `tests/kis_live`, `tests/alerts_live`, `tests/briefing_live -m kis_live` | 모두 통과 (국내 실시간은 장중) |
| G3 | `tests/llm_live`, `tests/briefing_live -m llm` | 통과 (LLM 호출 한도면 사유를 남기고 넘어감) |
| G4 | `tests/analysis_live` (실제 분석 2건, 약 30분) | Gemini 무료 등급 한도를 보고 판단, 결과 기록 |

## 결과 기록
- 실행 결과(실제 출력)는 PR과 로컬 진행 기록(PROGRESS.md)에 남긴다. 실패하면 원인과 고친 PR을 함께 적는다.
