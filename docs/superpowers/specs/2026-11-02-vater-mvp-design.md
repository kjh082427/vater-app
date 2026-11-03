# Vater 1차 버전(MVP) 설계 스펙

- **작성일:** 2026-11-02
- **상태:** 확정.
  - 사용자가 대화에서 하나씩 승인한 부분: 로컬 LLM, 아키텍처, 브랜치 전략, push 정책, 알림, 분석·브리핑.
  - 사용자가 "파일에 정리하고 진행"하라고 위임해 확정한 부분: 한투 연동·오류 처리, 화면 구성, 테스트, 빌드·배포, 개발 도구.
- **저장소:** github.com/kjh082427/vater-app (private)

---

## 0. 개요

### 한 줄 요약
한국투자증권 시세와 TradingAgents 멀티에이전트 분석을 결합한 **Windows 설치형 개인 투자 보조 앱**이다. 매매 판단과 주문은 사람이 하고, 앱은 AI 분석 리포트, 조건 알림, 일일 시장 브리핑을 제공한다.

### 사용자와 사용 환경
- 1인 사용자다. 개발자 본인이 아닐 수 있으며, 한국투자증권 키는 사용자 본인 계좌의 키를 쓴다.
- 사용 PC는 Windows 10/11이다. NVIDIA GPU PC와 내장 GPU PC를 모두 지원한다.
- 운영하는 서버가 없다. 설치 파일을 받아 **한 번 설치하면** 인터넷 연결만으로 계속 쓴다.

### 성공 기준
1. 설치 파일 하나로 **관리자 권한 없이** 설치되고, 첫 실행 마법사를 10분 안에 마칠 수 있다.
2. 창을 닫아도 트레이에서 알림 감시가 계속된다. 가격 조건을 충족한 뒤 알림이 뜨기까지 실시간 수신일 때 5초, 폴링일 때 60초를 넘지 않는다.
3. 국내 종목(예: 삼성전자)과 미국 종목(예: AAPL) 모두 AI 분석 1건이 끝까지 완료된다. 목표 소요 시간은 2단계 검증 실험 결과로 확정한다.
4. 거래일마다 국내와 미국 일일 브리핑이 자동으로 생성된다.
5. 새 버전이 나오면 자동 업데이트로 설치된다.
6. 코드에 **주문 API를 호출하는 경로가 하나도 없다.** 테스트로 이를 보장한다.

### 범위
| 구분 | 내용 |
|---|---|
| **1차 버전 포함** | AI 종목 분석 리포트, 가격·기술 지표·이벤트 알림, 일일 시장 브리핑, 로컬 LLM 선택 설치, 첫 실행 마법사, 자동 업데이트 |
| **2차 버전 이후** | 시세·캔들 차트 화면, 관심종목 전용 화면, 계좌 잔고·보유종목 조회, 국내 전용 데이터 어댑터(DART, 국내 뉴스), 공시 알림, 분봉 지표, 알림 발생 시 자동 분석, 앱 기능을 MCP 서버로 노출 |
| **하지 않음** | 주문·자동매매, 여러 사용자와 로그인, 서버 호스팅, macOS·Linux 배포 |

---

## 1. 핵심 결정 요약

| # | 결정 | 이유 |
|---|---|---|
| D1 | 보조 도구로 만들고 주문은 하지 않는다 | 안전하고 검증 부담이 적다 |
| D2 | 국내와 미국 시장을 모두 다룬다 | 사용자 요구. 국내 전용 데이터는 2차 버전에서 다룬다 |
| D3 | Tauri 2 + React/TS + Python 사이드카 | 공식 플러그인으로 자동 업데이트, 트레이, 알림, 자동 실행을 해결할 수 있다. Electron은 설치 파일이 더 크고, 순수 Python은 이 기능들을 직접 조립해야 한다 |
| D4 | LLM은 하이브리드(클라우드/로컬/혼합)이고 로컬은 선택 설치한다 | 사용자 PC 사양마다 로컬 LLM 가능 여부가 다르다 |
| D5 | 로컬 런타임은 Ollama를 쓴다 (llama.cpp 직접 포함 안 함) | 관리자 권한이 필요 없고, GPU 백엔드와 모델 관리를 맡겨도 되며, TradingAgents가 공식 지원한다 |
| D6 | 앱 영역 1개 = 브랜치 1개 = 폴더 1개 | 사용자가 영역별로 구조를 공부하고 수정하기 쉽다 |
| D7 | 알림은 상태가 바뀔 때만 보낸다 | 같은 조건이 유지되는 동안 반복해서 울리는 것을 막는다 |
| D8 | 지표 계산은 직접 구현하고 TA-Lib 기준값으로 테스트한다 | 의존성과 설치 크기를 줄이고, 학습용으로 읽기 좋은 코드가 된다 |
| D9 | 브리핑의 숫자는 LLM이 쓰지 않는다 | 수치 환각을 원천 차단한다 |
| D10 | 한투 제한값(토큰 만료, 호출 한도, 구독 수)은 응답값이나 설정값을 따른다 | 공식 수치를 확인하지 못했고, 나중에 바뀌어도 코드를 고칠 필요가 없다 |
| D11 | PyInstaller는 onedir 형식으로 만들어 Tauri resources로 포함한다 | onefile은 매번 압축을 풀어 시작이 느리고 백신 오탐이 잦다 |

---

## 2. 전체 아키텍처

```
사용자 Windows PC
│
├─ Vater.exe ─ Tauri 2 셸 (Rust, 얇은 계층)
│   ├─ 창 · 트레이 · 단일 인스턴스 · 부팅 시 자동 실행 · 자동 업데이트 · Windows 알림
│   ├─ React UI (WebView2) ──── HTTP + SSE ────► 사이드카
│   └─ 사이드카 실행/감시/재시작 ◄── stdout JSON 이벤트 ── 사이드카
│
├─ vater-core (Python 사이드카, FastAPI, 127.0.0.1 전용)
│   ├─ api        REST 라우터 · SSE 스트림 · 토큰 인증
│   ├─ store      SQLite 저장소
│   ├─ secrets    비밀키 저장 (운영: Windows 자격 증명 관리자 / 개발: .env)
│   ├─ kis        한투 토큰 · 시세 REST · 실시간 WebSocket · 호출 제한 · 종목 마스터
│   ├─ llm        GPU 감지 · Ollama 관리 · 모델 카탈로그 · 프리셋 → TradingAgents 설정
│   ├─ analysis   TradingAgents 실행 · 작업 큐 · 진행 스트리밍 · 리포트
│   ├─ alerts     감시 종목 · 지표 계산 · 규칙 평가 · 쿨다운 · 장 운영 시간
│   └─ briefing   일일 시장 데이터 수집 · LLM 해석 · 일정 실행
│
└─ Ollama (선택 설치, localhost:11434)

외부: 한국투자증권 Open API · Yahoo Finance 등(TradingAgents 데이터) · 클라우드 LLM API
```

### 2-1. 프로세스 수명
- Tauri가 시작되면 사이드카를 실행한다. 이때 일회용 토큰을 환경변수 `VATER_TOKEN`으로 넘긴다.
- 사이드카는 포트 0으로 바인딩해 운영체제가 빈 포트를 정하게 한 뒤, stdout에 `{"type":"ready","port":N}`을 출력한다.
- Tauri는 이 포트와 토큰을 Tauri 커맨드 `get_sidecar_info`로 UI에 넘긴다. UI는 모든 요청에 `Authorization: Bearer <token>` 헤더를 붙인다.
  - 예외: 브라우저의 `EventSource`는 헤더를 붙일 수 없으므로 `GET /events`만 `?token=` 쿼리 파라미터로도 인증한다.
- 사이드카는 Tauri 출처(`tauri://localhost`, `http://tauri.localhost`, `https://tauri.localhost`)의 요청만 CORS로 허용한다. 개발 모드(`VATER_DEV=1`)에서는 `http://localhost:5173`도 허용한다.
- **창을 닫으면 트레이로 숨긴다.** 처음 숨길 때 "Vater는 트레이에서 계속 실행됩니다" 알림을 한 번 보여준다. 완전히 끄려면 트레이 메뉴의 "종료"를 누르며, 이때 사이드카에 종료 요청을 보내고 5초 안에 끝나지 않으면 강제 종료한다.
- 사이드카가 비정상 종료되면 Tauri가 자동으로 다시 실행한다. 10분 안에 3회를 넘으면 재시작을 멈추고 오류 화면을 띄운다.
- 앱을 두 번 실행하면 새로 뜨지 않고 기존 창을 앞으로 가져온다(단일 인스턴스).

### 2-2. 통신
- **UI → 사이드카:** 일반 요청은 REST로 보낸다.
- **사이드카 → UI:** `GET /events` SSE 하나로 보낸다. 이벤트 종류는 시세 갱신, 분석 진행, 알림 발생, 브리핑 도착, 연결 상태 변화다.
- **사이드카 → Rust:** stdout에 JSON 한 줄씩 출력한다. 종류는 `ready`, `notify`(제목, 본문, 이동할 화면), `log`다. Windows 알림은 Rust가 띄우므로 창이 숨겨져 있어도 확실히 뜬다.
- **API 계약:** FastAPI가 생성하는 OpenAPI 명세에서 TypeScript 타입을 자동 생성한다(`openapi-typescript`). 명세의 스냅샷 테스트로 계약이 바뀌면 바로 드러나게 한다.

### 2-3. 사이드카 REST API (1차 버전)
| 영역 | 엔드포인트 |
|---|---|
| 공통 | `GET /health`, `GET /events` (SSE), `POST /shutdown` (정상 종료 요청) |
| 종목 | `GET /symbols/search?q=` |
| 감시·알림 | `GET/POST/DELETE /watchlist`, `GET/POST/PATCH/DELETE /alerts/rules`, `GET /alerts/events`, `POST /alerts/pause`, `POST /alerts/resume` |
| 분석 | `POST /analyses`, `GET /analyses`, `GET /analyses/{id}`, `POST /analyses/{id}/cancel` |
| 브리핑 | `GET /briefings`, `GET /briefings/{id}`, `POST /briefings/run` |
| 설정 | `GET/PATCH /settings`, `PUT /secrets/{name}` (쓰기 전용, 비밀키는 읽기 API가 없음), `POST /settings/kis/test` |
| LLM | `GET /llm/hardware`, `GET /llm/catalog`, `GET /llm/ollama/status`, `POST /llm/ollama/install`, `POST /llm/models/{tag}/pull` (진행률은 SSE로), `DELETE /llm/models/{tag}` |

### 2-4. 저장
- 위치: `%APPDATA%\Vater\` 아래 `vater.db`(SQLite), `logs\`, `cache\`(종목 마스터, 일봉).
- 비밀키(한투 appkey·appsecret·HTS ID, 클라우드 LLM 키, 한투 접근 토큰 캐시)는 `keyring`으로 Windows 자격 증명 관리자에 저장한다. **DB와 로그에는 절대 저장하지 않는다.**
- 주요 테이블:
  - `watchlist`: 시장, 종목 코드, 거래소, 이름
  - `alert_rules`: 종목, 종류, 파라미터 JSON, 확인 시점, 사용 여부, 직전 상태, 마지막 발생 시각
  - `alert_events`: 규칙, 발생 시각, 값, 메시지
  - `analyses`: 종목, 기준일, 프리셋, 모델, 상태, 결정, 요약, 리포트 JSON, 소요 시간, 토큰 수
  - `briefings`: 날짜, 시장, 수집 데이터 JSON, 해석 문장, 상태, 빠진 항목
  - `settings`: 키, 값
- 스키마 마이그레이션은 버전 번호와 순차 SQL 파일로 단순하게 관리한다.

### 2-5. 종목 식별
- 국내 종목은 한투 종목 마스터(코스피·코스닥)로 검색한다. TradingAgents에 넘길 때는 Yahoo 티커로 바꾼다. 코스피는 `.KS`, 코스닥은 `.KQ`를 붙인다(예: `005930` → `005930.KS`).
- 미국 종목은 티커와 함께 거래소 코드(NAS/NYS/AMS)를 저장한다. 한투 해외 시세 API가 이 코드를 요구한다.
- 모든 일정은 `zoneinfo`로 시간대를 지정해 계산한다. 국내는 `Asia/Seoul`, 미국 장은 `America/New_York` 기준이다.

---

## 3. LLM: 프리셋, 로컬 선택 설치, 모델 카탈로그

### 3-1. 프리셋
| 프리셋 | quick_think (애널리스트, 토론자, 트레이더) | deep_think (리서치·포트폴리오 매니저) | 브리핑 |
|---|---|---|---|
| 클라우드 전용 | 클라우드 | 클라우드 | 클라우드 |
| 로컬 전용 | 로컬 | 로컬 | 로컬 |
| **혼합** (NVIDIA VRAM 12GB 이상 기본값) | 로컬 | 클라우드 | 클라우드 |

- 클라우드 제공자는 Anthropic(Claude), OpenAI, Google(Gemini), 그리고 OpenAI 호환 서버(기타)다. 구체적인 기본 모델명은 `core/llm`을 구현할 때 각 제공자의 최신 문서로 확정하고 카탈로그 파일에 둔다.
- 내장 GPU PC와 **NVIDIA VRAM 8GB PC의 기본값은 클라우드 전용**이다(검증 실험 S1: 8GB에 맞는 4b 모델은 완주하지만 보고서가 비거나 수치를 지어낸다). 8GB PC도 로컬·혼합을 직접 고를 수 있다.
- 혼합 프리셋을 고르면 설정 화면에 "로컬 모델이 애널리스트 보고서를 씁니다. 클라우드보다 느리고 품질이 낮을 수 있습니다"를 표시한다(검증 실험 S8).

### 3-2. 로컬 LLM 선택 설치 흐름
1. 기본 설치 파일에는 LLM이 없다. 첫 실행 마법사나 설정 화면에서 "로컬 AI 설치"를 고를 때만 진행한다.
2. GPU를 감지한다. `nvidia-smi`가 있으면 NVIDIA 이름과 VRAM 용량을 읽고, 없으면 내장 GPU로 판단한다. 시스템 RAM 용량도 함께 확인한다.
3. 감지 결과에 맞는 추천 모델과 예상 속도를 보여준다.
4. Ollama가 없으면 공식 Windows 설치 파일을 받아 실행한다. 관리자 권한은 필요 없지만, 무인 설치 옵션이 문서에 없으므로 설치 창은 사용자가 직접 진행한다. 설치가 끝나면 `localhost:11434`로 동작을 확인한다.
5. 모델은 Ollama `/api/pull`로 받고, 진행률은 SSE로 화면에 보여준다.
6. 설정 화면에서 모델 변경, 삭제(`/api/delete`), 프리셋 전환을 언제든 할 수 있다.

### 3-3. 모델 카탈로그 (`llm/catalog.json`, 앱 업데이트 때 함께 갱신)
2026-11 Ollama 라이브러리 기준이다. 2단계 검증 실험(S1, S8)으로 확정했다. 모델 크기는 2026-11-03 Ollama 레지스트리 기준이다.

| 하드웨어 등급 | 기본 프리셋 | 추천 로컬 모델 | 대안 |
|---|---|---|---|
| NVIDIA VRAM 8GB | **클라우드** | `qwen3.5:4b` (3.3GB, 다 올라감, 분석 1건 약 22분) | `qwen3.5:9b`는 **비추천** (6.7GB 중 1.1GB가 CPU로 넘어가 약 56분) |
| NVIDIA 12~16GB | 혼합 | `qwen3.5:9b` (6.6GB) | `gemma4:12b` (8.0GB) |
| NVIDIA 24GB 이상 | 혼합 | `qwen3.8:27b` (17.7GB) | — |
| 내장 GPU / CPU | 클라우드 | (클라우드 권장) | `qwen3.5:2b` (2.7GB, 실험용, 매우 느림) |

- 12GB 이상 등급은 개발 PC(8GB)로 측정하지 못했다. 크기 기준으로 다 올라갈 것으로 보고 정한 값이다.
- 공통 Ollama 옵션: `num_ctx`는 모델별 값을 카탈로그에 둔다(27b는 32K, 나머지 16K). TradingAgents에는 `num_ctx` 설정이 없으므로 `num_ctx`를 고정한 변형 모델(`<tag>-16k`)을 `/api/create`로 만들어 쓴다.
- 모델이 VRAM에 다 올라갔는지는 Ollama `/api/ps`의 `size_vram`과 `size`를 비교해 확인한다. `size_vram`이 `size`보다 작으면 일부가 CPU로 넘어간 것이므로 경고하고 더 작은 모델을 추천한다.

---

## 4. 알림

### 4-1. 규칙 종류 (기간과 기준값은 사용자가 조정)
| 분류 | 조건 | 기본값 | 기본 확인 시점 |
|---|---|---|---|
| 가격 | 목표가 이상/이하 | — | 장중 실시간 |
| 가격 | 전일 대비 ±N% | 5% | 장중 실시간 |
| 추세 | 이동평균선 골든/데드크로스 | 5일 / 20일 | 장 마감 후 |
| 추세 | 가격의 이동평균선 돌파/이탈 | 20일 | 장 마감 후 |
| 모멘텀 | RSI 과매수/과매도 진입 | 14일, 70 / 30 | 장 마감 후 |
| 모멘텀 | MACD와 시그널선 교차 | 12 / 26 / 9 | 장 마감 후 |
| 변동성 | 볼린저밴드 상단/하단 이탈 | 20일, 2σ | 장 마감 후 |
| 거래량 | 거래량 급증 | 20일 평균의 3배 | 장중 실시간 |
| 신고가 | 52주 신고가/신저가 경신 | — | 장중 실시간 |
| 이벤트 | AI 분석 완료, 일일 브리핑 도착 | — | 즉시 |

### 4-2. 평가 규칙
- **상태가 바뀔 때만 알린다.** 각 규칙은 직전 상태(참/거짓)를 저장하고, 거짓에서 참으로 바뀌는 순간에만 알림을 보낸다. 같은 규칙은 기본적으로 하루 최대 1회다(쿨다운).
- **확인 시점**
  - "장 마감 후": 확정된 일봉 종가로 계산한다.
  - "장중 실시간(잠정)": 현재가를 오늘 종가로 가정해 계산한다. 규칙마다 바꿀 수 있다.
- **지표 구현:** `alerts/indicators.py`에 numpy/pandas로 순수 함수로 구현한다. 대상은 SMA, EMA, RSI(Wilder 방식), MACD, 볼린저밴드, 거래량 이동평균, 52주 최고·최저다. TA-Lib 결과와 비교하는 테스트로 정확성을 보장하며, TA-Lib은 개발 의존성으로만 쓴다.
- **시세 수신**
  - 장중에는 한투 WebSocket 체결가를 받는다. 구독 한도를 넘거나 연결이 끊긴 종목은 REST 폴링으로 처리한다(기본 30초, 설정 가능).
  - 일봉은 장 마감 후 하루 한 번 갱신해 `cache\`에 저장한다. 지표 계산에는 최근 260거래일을 쓴다.
- **장 운영 시간:** 국내는 09:00~15:30 KST, 미국은 정규장 09:30~16:00 America/New_York이다. 휴장일은 국내는 한투 휴장일 API, 미국은 `exchange_calendars`로 판단한다. 장 외 시간에는 실시간 감시를 쉰다.
- **전달:** 사이드카가 stdout으로 `notify` 이벤트를 보내면 Rust가 Windows 알림을 띄운다. 같은 이벤트를 SSE로도 보내 UI의 알림 이력에 반영한다. 알림을 클릭하면 해당 종목 화면으로 이동한다.
- 트레이 메뉴에서 감시를 일시 중지하고 재개할 수 있다.

---

## 5. AI 종목 분석 (TradingAgents)

- **사용 버전:** TradingAgents v0.7.1(2026-10, Apache-2.0). `TradingAgentsGraph(config).propagate(ticker, date)`를 라이브러리처럼 호출한다.
- **분석 경계:** `analysis/engine.py`의 `AnalysisEngine` 인터페이스 뒤에 TradingAgents를 숨긴다. 테스트에서는 가짜 엔진으로 바꿔 끼운다. TradingAgents 버전이 바뀌어도 영향은 이 파일에만 미친다.
- **입력:** 종목(국내 코드 또는 미국 티커)과 기준일(기본 최근 거래일).
- **기본 옵션**
  - 토론 라운드 1회(리서치, 리스크 모두).
  - 국내 종목은 소셜 애널리스트를 끈다. StockTwits와 Reddit에는 국내 종목 데이터가 거의 없다.
  - **국내 종목(`.KS`/`.KQ`)은 한투 데이터 공급자 `kis`를 쓴다**(검증 실험 S2). Yahoo에는 국내 재무·뉴스가 없고 일봉이 하루 늦다. `kis` 공급자는 한투 일봉, 재무제표·재무비율, 뉴스 제목을 TradingAgents 도구 형식으로 돌려준다.
  - 프리셋은 설정값을 따른다.
- **실행**
  - 작업 큐에서 한 번에 1건씩 처리한다. 상태는 `queued → running → done | failed | cancelled`이고 실행 중에 취소할 수 있다.
  - TradingAgents 체크포인트(`checkpoint_enabled=True`)를 켠다(검증 실험 S5에서 확인). 실패하거나 강제 종료된 분석을 [다시 시도]하면 **같은 종목·기준일·프리셋**으로 실행해서 끝난 단계를 건너뛴다. 체크포인트는 `%APPDATA%\Vater\cache\tradingagents\checkpoints\<종목>.db`에 있고, 완주하면 지운다.
- **진행 스트리밍:** `graph.stream(subgraphs=True, stream_mode=["updates", "values"])`로 LangGraph 노드 이벤트를 받아 SSE로 전달한다(검증 실험 S6). 화면은 애널리스트 → 강세/약세 토론 → 트레이더 → 리스크 토론 → 포트폴리오 매니저 순서의 타임라인으로 보여주고, 단계별 경과 시간을 표시한다. 애널리스트 4명은 병렬로 돌고, 서브그래프 namespace로 구분한다.
- **결과**
  - 최종 결정: TradingAgents의 5단계 등급 Buy / Overweight / Hold / Underweight / Sell과, 읽어낼 수 없을 때의 REVIEW(검증 실험 S4). 화면 표기는 매수 / 비중확대 / 보유 / 비중축소 / 매도 / 검토 필요다.
  - 핵심 근거 3줄 요약.
  - 에이전트별 보고서 전문.
  - 실행 정보: 프리셋, 모델, 소요 시간, 토큰 수(LangChain 콜백으로 집계), 예상 비용(카탈로그의 가격표).
- **한국어:** 리포트는 한국어로 제공한다. TradingAgents의 `output_language="Korean"`을 쓴다(검증 실험 S3). 뒤쪽 단계(트레이더, 최종 결정)는 한국어로 나오지만 일부 애널리스트 보고서는 영어로 나올 수 있으므로, 화면은 최종 결정과 3줄 요약을 먼저 보여주고 애널리스트 원문 탭에는 "원문(영어일 수 있음)"이라고 표시한다. 별도 번역 단계는 만들지 않는다.
- **결과의 변동:** 같은 종목·같은 날짜라도 모델과 실행에 따라 결정이 달라진다(검증 실험에서 AAPL 한 종목에 Hold, Sell, Buy, Underweight가 모두 나옴). 결과 화면에 "모델과 실행에 따라 결론이 달라질 수 있습니다"를 표시한다.
- **이력:** 종목별 분석 목록을 보여주고, 직전 분석과 결정이 달라졌으면 표시한다.
- **면책:** 결과 화면마다 "투자 판단 보조용이며 투자 권유가 아닙니다"를 표시한다.

---

## 6. 일일 시장 브리핑

- **일정:** 국내는 16:00 KST, 미국은 07:00 KST(미국 장 마감 다음 날 아침)에 실행한다. 시간은 설정에서 바꿀 수 있고 시장별로 켜고 끌 수 있다. 휴장일에는 건너뛴다.
- **놓친 경우:** 앱이 꺼져 있어서 놓쳤다면 다음에 실행할 때 **가장 최근 1회분만** 만든다.
- **수집 (한투 API):** 주요 지수(KOSPI·KOSDAQ / S&P500·NASDAQ 종합·NASDAQ100), 업종별 등락, 등락률·거래대금 상위, 외국인·기관 순매수(국내), 감시 종목의 오늘 등락과 오늘 발생한 알림. 다우존스 지수는 한투 API에 없어서 NASDAQ100으로 대신한다(`core/kis` 실연동, `docs/kis-live-findings.md`).
- **해석:** 수집 데이터를 JSON으로 정리해 deep_think 모델을 1회 호출한다. 출력 형식은 `{headline, market, sectors, flows, notable, watchlist}`이며 모든 항목이 문장이다. TradingAgents는 쓰지 않는다.
- **숫자 환각 차단:** 지수, 등락률 같은 숫자는 UI가 수집 데이터로 직접 표와 미니 차트를 그린다. LLM 출력은 해석 문장으로만 쓴다. 프롬프트에서도 숫자를 반복하지 말라고 지시한다.
- **부분 실패:** 받은 데이터만으로 브리핑을 만들고, 빠진 항목은 `missing` 필드에 기록해 화면에 표시한다.
- **결과:** 브리핑 화면에 보여주고 "오늘의 시장 브리핑" 알림을 보낸다. 이력을 보관한다.

---

## 7. 한국투자증권 연동 규칙

1. **인증**
   - 접근 토큰의 만료 시각은 발급 응답에 담긴 값을 저장한다(알려진 유효기간은 약 24시간). 만료 1시간 전에 미리 재발급한다.
   - 토큰은 자격 증명 관리자에 캐시해서, 앱을 다시 시작해도 재발급하지 않게 한다.
   - 여러 요청이 동시에 발급을 시도해도 비동기 잠금으로 **한 번만** 발급한다. 알려진 제한은 분당 1회다.
   - WebSocket 승인키는 따로 발급한다.
   - 실전(`prod`)과 모의(`vps`) 서버 중 하나를 고르며 키도 서버별로 다르다. 연결 테스트는 삼성전자 현재가를 조회해 본다.
2. **호출 제한**
   - 비동기 토큰 버킷으로 앱 안에서 초당 호출 수를 제한한다. 한도는 실전과 모의 각각 설정값으로 두고 기본값은 보수적으로 잡는다. 공식 수치는 `core/kis` 첫 작업에서 KIS Developers 문서로 확정한다.
   - `EGW00201`(초당 한도 초과) 응답을 받으면 0.5초, 1초, 2초 간격으로 최대 3회 재시도한다.
   - 우선순위는 알림 감시 > 브리핑 수집 > 종목 마스터 갱신이다.
3. **WebSocket**
   - 구독 한도는 설정값이다(기본 41). 넘친 종목은 폴링으로 처리한다.
   - 서버가 보내는 `PINGPONG`에 응답한다.
   - 끊기면 1초, 2초, 4초…처럼 간격을 늘려 최대 60초까지 재연결한다. 끊긴 동안은 폴링으로 대체하고, 다시 연결되면 구독을 복원한다.
4. **읽기 전용 보장**
   - 주문, 정정, 취소 API는 **구현하지 않는다.**
   - `tests/test_readonly_guarantee.py`가 소스 전체에서 주문용 거래 ID(TR ID) 패턴과 주문 엔드포인트 경로를 검사해, 하나라도 있으면 실패한다.
5. **종목 마스터:** 한투가 제공하는 마스터 파일(국내 코스피·코스닥, 해외 거래소별)을 하루 1회 받아 로컬 검색 색인을 만든다.
6. **개발 참고:** 공식 저장소 `koreainvestment/open-trading-api`의 예제와 KIS Code Assistant MCP를 참고한다. 공식 샘플을 그대로 가져오지 않고, 비동기 `httpx` 클라이언트로 다시 구현한다.

---

## 8. 오류 처리

**원칙:** 실패는 숨기지 않는다. 화면에 원인과 해결 방법을 보여준다. 일부가 실패해도 백그라운드 기능(알림 감시)은 계속 돈다.

| 상황 | 앱 동작 | 사용자에게 보이는 것 |
|---|---|---|
| 인터넷 끊김 | 감시를 일시 중지하고 30초마다 다시 확인, 복구되면 자동 재개 | 상단 배너 "오프라인: 알림 감시 일시 중지" |
| 한투 키가 틀렸거나 만료됨 | 해당 기능만 중지 | "키를 확인하세요" + 설정 바로가기 |
| 한투 호출 한도 초과 | 대기 후 재시도 | 표시하지 않음 (반복되면 로그) |
| WebSocket 끊김 | 재연결하면서 폴링으로 대체 | 감시 상태를 "실시간 → 폴링"으로 표시 |
| 클라우드 LLM 실패 | 2회 재시도 후 실패 처리, 체크포인트 보존 | "분석 실패: 원인" + [다시 시도] [프리셋 변경] |
| Ollama가 꺼져 있음 | 자동 실행 시도 | "로컬 AI 시작 중…", 실패하면 해결 방법 안내 |
| 모델이 VRAM에 다 안 올라감 | `/api/ps`로 감지 | 속도 경고 + 더 작은 모델 추천 |
| 사이드카 비정상 종료 | 자동 재시작 (10분에 최대 3회) | 넘으면 오류 화면 + [로그 폴더 열기] |
| 브리핑 데이터 일부 실패 | 받은 데이터로만 생성 | 빠진 항목 표시 |
| 앱 업데이트 실패 | 현재 버전 유지, 다음 실행 때 재시도 | 표시하지 않음 |

- **오류 형식:** 사이드카의 모든 오류 응답은 `{code, message, hint}` 형식을 따른다. `code`는 `KIS_AUTH_INVALID`처럼 정해진 값이고, UI는 이 코드로 안내 문구와 버튼을 정한다.
- **로그:** `%APPDATA%\Vater\logs\`에 남기고 5MB마다 새 파일로 넘기며 5개까지 보관한다. 키와 토큰은 로그 필터에서 마스킹한다(필터 테스트 포함).

---

## 9. 화면 구성

시각 디자인(색, 글꼴, 레이아웃 스타일)은 `ui/design-system` 브랜치에서 디자인 스킬로 정한다(12-2 참고). 여기서는 화면 구조만 정한다.

### 9-1. 전체 구조
- **왼쪽 사이드바:** 홈 · 분석 · 감시·알림 · 브리핑 · 설정
- **하단 상태 표시줄:** 시장 상태(국내 장중/마감, 미국 장중/마감), 한투 연결 상태(실시간/폴링/끊김), AI 엔진 상태(프리셋, 로컬 모델 동작 여부)
- **공통 요소:** 오프라인 배너, 면책 문구, 한국어 UI
- **색 관례:** 국내 관례에 따라 **상승은 빨강, 하락은 파랑**이다. 미국 종목에도 똑같이 적용한다.
- **숫자 표기:** 원화는 천 단위 구분자와 "원", 달러는 `$`와 소수점 2자리.

### 9-2. 화면 목록
| 화면 | 내용 |
|---|---|
| **첫 실행 마법사** | ① 환영·면책 → ② 한투 연결(실전/모의 선택, appkey·appsecret·HTS ID 입력, 연결 테스트) → ③ AI 엔진(클라우드 키 입력 / 로컬 설치: GPU 감지 결과, 추천 모델, 다운로드 진행률 / 나중에) → ④ 감시 종목 추가(선택) → ⑤ 완료(부팅 시 자동 실행 여부, 기본값 켬) |
| **홈** | 최근 브리핑 카드, 감시 종목 목록(현재가, 등락, 수신 상태), 최근 알림 5개, 진행 중인 분석 |
| **분석** | 새 분석(종목 검색, 옵션) / 진행 타임라인 / 결과 상세(결정 배지, 3줄 요약, 에이전트별 탭, 실행 정보) / 이력(종목별, 결정 변화) |
| **감시·알림** | 감시 종목 추가·삭제 / 종목별 규칙 목록 / 규칙 편집기(종류 → 파라미터 → 확인 시점 → 미리보기: 현재 지표값) / 알림 이력(필터) |
| **브리핑** | 날짜·시장별 목록 / 상세(LLM 해석 문장 + 데이터 표·미니 차트: 지수, 업종, 상위 종목, 수급, 내 감시 종목) |
| **설정** | 한투(키 변경, 서버, 연결 테스트) / AI 엔진(프리셋, 클라우드 키, 로컬 모델 관리) / 분석 기본값(토론 라운드, 애널리스트) / 브리핑(시간, 시장 켜기·끄기) / 일반(자동 실행, 창 닫기 동작, 업데이트 확인, 로그 폴더 열기, 버전) |
| **트레이 메뉴** | 열기 · 감시 일시 중지/재개 · 종료 |

### 9-3. 화면 이동 원칙
- 알림을 클릭하면 해당 종목의 감시·알림 화면으로 간다. 분석 완료 알림은 분석 결과 화면으로 간다.
- Tauri API(알림, 트레이 등)는 `src/platform/` 어댑터 뒤에 둔다. 그래야 브라우저(Vite 개발 서버)에서도 UI를 개발하고 테스트할 수 있다.

---

## 10. 테스트

모든 기능은 `superpowers:test-driven-development`에 따라 테스트를 먼저 쓴다.

| 대상 | 도구 | 방법 |
|---|---|---|
| 사이드카 전반 | pytest, pytest-asyncio | 모듈별 단위 테스트 |
| 한투 REST | respx (httpx 목) | 실제 응답 형식을 녹화한 픽스처로 재생. 실제 키는 `@pytest.mark.kis_live` 테스트에서만 쓰고 기본적으로 건너뜀 |
| 한투 WebSocket | 가짜 WebSocket 서버 | 구독, PINGPONG, 재연결, 폴링 대체 |
| 지표 | TA-Lib (개발 의존성) | 같은 입력으로 TA-Lib 결과와 비교 |
| 알림 엔진 | time-machine (시간 고정) | 상태 전환, 쿨다운, 장 운영 시간, 휴장일 |
| 분석 | 가짜 `AnalysisEngine` | 큐, 취소, 진행 이벤트, 실패 처리. 실제 TradingAgents는 `@pytest.mark.llm`에서만 |
| 브리핑 | 가짜 LLM | 일정, 놓친 브리핑 처리, 부분 실패, 출력 스키마(숫자 필드 없음) |
| 읽기 전용 보장 | 소스 검사 테스트 | 7-4 |
| 로그 마스킹 | 단위 테스트 | 키·토큰 패턴 |
| API 계약 | OpenAPI 스냅샷 | 명세가 바뀌면 실패 → 의도한 변경이면 스냅샷 갱신 |
| UI 컴포넌트 | Vitest, React Testing Library, MSW | 사이드카 API를 목으로 대체 |
| UI 흐름 | Playwright | Vite 개발 서버 + 개발 모드 사이드카로 마법사, 알림 규칙 생성, 분석 흐름 확인 |
| Rust 셸 | cargo test | stdout 이벤트 파싱, 재시작 정책 |

- **코드 품질:** Python은 ruff(포맷·린트)와 mypy, 프런트엔드는 ESLint, Prettier, `tsc --noEmit`을 쓴다.
- **CI (GitHub Actions)**
  - 모든 PR: Ubuntu에서 사이드카 테스트·린트와 프런트엔드 테스트·린트.
  - `shell/*`, `infra/*` PR과 태그: Windows 러너에서 사이드카 PyInstaller 빌드와 Tauri 빌드가 성공하는지 확인.

---

## 11. 빌드와 배포

- **개발 환경 (WSL2)**
  - 사이드카: Python 3.13 + uv. Python 3.14는 의존성 호환이 불확실해 3.13으로 고정한다.
  - UI: Node 24 + npm(`package-lock.json` 커밋), Vite 개발 서버. 브라우저에서 사이드카와 붙여 개발한다. (처음에는 pnpm으로 정했으나 `ui/design-system`에서 npm으로 시작했다. 기능 차이가 없어 npm을 유지한다.)
  - Tauri 셸: WSL에서 GUI 빌드에 필요한 시스템 라이브러리 설치가 부담이라, 컴파일 검증은 Windows CI에서 한다.
- **사이드카 패키징:** PyInstaller **onedir** 형식으로 `vater-core\` 폴더를 만들어 Tauri `resources`로 포함한다. Rust가 실행 경로를 계산해 직접 실행한다.
- **설치 파일:** Tauri NSIS를 쓰고 `installMode: currentUser`로 관리자 권한 없이 설치되게 한다. WebView2는 부트스트래퍼를 포함해 없으면 자동 설치한다.
- **자동 업데이트:** `tauri-plugin-updater`가 GitHub Releases의 `latest.json`을 확인한다. 업데이트 서명 키는 GitHub Actions 비밀값에 둔다. 저장소가 private이므로, 업데이트 파일은 **공개 릴리스 전용 저장소**에 올리거나 업데이트 확인용 토큰을 쓰는 방식 중 하나를 `infra/release`에서 정한다. 기본안은 공개 릴리스 전용 저장소 `kjh082427/vater-releases`이며, 바이너리만 올라가고 소스는 올라가지 않는다.
- **코드 서명 (Authenticode):** 1차 버전은 서명하지 않는다. 처음 설치할 때 SmartScreen 경고("Windows PC 보호")가 뜨며, "추가 정보 → 실행"으로 넘어가야 한다는 안내를 README와 설치 안내에 넣는다. 유료 서명(Azure Trusted Signing 등)은 2차 버전에서 검토한다.
- **버전:** 앱은 SemVer를 쓰고, `v0.1.0` 같은 태그를 push하면 릴리스 워크플로가 돈다. 단계 완료 태그(`stage-N-…`)는 앱 버전 태그와 따로 관리한다.

---

## 12. 개발 방식

### 12-1. 브랜치, PR, push
- **원칙:** 앱 영역 1개 = 브랜치 1개 = 폴더 1개.

| # | 브랜치 | 폴더 | 단계 |
|---|---|---|---|
| 0 | `main` 첫 커밋 | `docs/`, `.claude/`, `.github/`, `README.md`, `CLAUDE.md` | 1 |
| 1 | `spike/tradingagents-local-llm` | `spikes/` | 2 |
| 2 | `core/foundation` | `sidecar/src/vater_core/{api,store,secrets}` | 3 |
| 3 | `core/kis` | `sidecar/src/vater_core/kis` | 3 |
| 4 | `core/llm` | `sidecar/src/vater_core/llm` | 3 |
| 5 | `core/analysis` | `sidecar/src/vater_core/analysis` | 3 |
| 6 | `core/alerts` | `sidecar/src/vater_core/alerts` | 3 |
| 7 | `core/briefing` | `sidecar/src/vater_core/briefing` | 3 |
| 8 | `shell/tauri` | `apps/desktop/src-tauri` | 4 |
| 9 | `ui/design-system` | `apps/desktop/src/design-system` | 4 |
| 10 | `ui/screens` | `apps/desktop/src/screens`, `src/platform` | 4 |
| 11 | `infra/release` | `.github/workflows/release*`, `packaging/` | 5 |

- **의존 관계**

  ```
  core/foundation ─┬─► core/kis ──┬─► core/alerts
                   │              └─► core/briefing ◄─┐
                   └─► core/llm ────► core/analysis   │
                            └─────────────────────────┘
  core/* ─(OpenAPI → TS 타입)─► ui/screens ◄── ui/design-system
  core/* ─(PyInstaller)───────► shell/tauri ──► infra/release
  ```

- **push:** 계획서의 작업 1개가 끝날 때마다 해당 브랜치에 커밋하고 push한다.
- **merge**
  - 브랜치가 완성되면 PR을 만들고, CI를 통과하면 **merge 커밋**(`--merge`, squash 아님)으로 main에 합친다. **merge한 브랜치는 지우지 않는다.**
  - PR 설명은 `.github/pull_request_template.md`의 4개 항목(무엇을 / 어느 파일 / 확인 방법 / 공부 포인트)을 따른다. 라벨은 `area:core`, `area:ui`, `area:shell`, `area:infra`, `area:spike`, `area:docs`다.
- **태그:** 단계가 끝나면 main에 `stage-N-<이름>` 태그를 붙인다.
- **나중에 수정할 때:** 같은 접두어로 새 브랜치를 만든다(예: `ui/redesign-v2`).
- **작업 공간:** 각 브랜치는 `superpowers:using-git-worktrees`에 따라 별도 worktree에서 작업한다.

### 12-2. 개발 도구 (Claude Code 생태계)
| 분류 | 도구 | 쓰는 곳 |
|---|---|---|
| 진행 방식 | superpowers: brainstorming, writing-plans, subagent-driven-development, test-driven-development, using-git-worktrees, requesting-code-review, verification-before-completion, finishing-a-development-branch | 모든 단계 |
| UI 디자인 | **ui-ux-pro-max**: 디자인 시스템, 토큰, 차트 유형 | `ui/design-system` |
| UI 디자인 | **taste-skill** (`design-taste-frontend`): 앱 화면 아트 디렉션, 브라우저 점검 | `ui/design-system`, `ui/screens` |
| UI 디자인 | **impeccable**: `init`(PRODUCT.md), `shape`, `critique`, `audit`, `polish`, `document`(DESIGN.md) | `ui/*` 시작과 마무리 |
| UI 디자인 | frontend-design | 보조 |
| 문서·도식 | diagram-design | `docs/ARCHITECTURE.md` 구조도 |
| 리뷰 | code-review, security-review, simplify | 각 PR 전 |
| MCP (필요할 때 설치) | KIS Code Assistant MCP (한투 공식) | `core/kis` |
| MCP (필요할 때 설치) | Context7 (최신 라이브러리 문서: Tauri 2, LangGraph, FastAPI 등) | 전체 |
| MCP (필요할 때 설치) | Playwright MCP (UI 확인, E2E 작성) | `ui/*` |
| 프로젝트 전용 스킬 (직접 작성) | `kis-api-rules`: 한투 토큰, 호출 제한, TR ID 규칙, 읽기 전용 원칙 | `.claude/skills/` |
| 프로젝트 전용 스킬 (직접 작성) | `vater-branch-workflow`: 브랜치 생성, PR 템플릿, 라벨, merge 커밋, 브랜치 유지 | `.claude/skills/` |
| 훅 | impeccable 훅(프로젝트 범위), 로컬 전용 설정(`settings.local.json`, git 제외)의 SessionStart 훅이 로컬 진행 기록의 "현재 위치"를 불러옴 | `.claude/` |

- 설치한 도구는 모두 `docs/TOOLING.md`에 기록한다.

---

## 13. 미검증 가정 (2단계 검증 실험 항목)

결과의 근거는 `spikes/tradingagents-local-llm/REPORT.md`(2026-11-03 측정)다.

| # | 확인할 것 | 실패하면 | 결과 |
|---|---|---|---|
| S1 | `qwen3.5:4b`, `qwen3.5:9b`로 TradingAgents 파이프라인을 끝까지 완주하는지(도구 호출 오류율, 소요 시간). 개발 PC는 RTX 3080 Laptop 8GB | 카탈로그 기본값 변경. 8GB 등급의 기본 프리셋을 "혼합"에서 "클라우드"로 변경 | ⚠️ 둘 다 완주. 4b는 22~31분이지만 품질 부족, 9b는 CPU로 넘어가 56분 → **8GB 기본 프리셋 클라우드**(3-1, 3-3) |
| S2 | 국내 종목(`005930.KS`, 코스닥 1개)의 가격·재무·뉴스 데이터 품질 | 국내 종목은 해당 애널리스트를 끄고, 국내 데이터 어댑터를 앞당김 | ❌ 가격·지표만 있음 → **한투 `kis` 공급자를 1차 버전에 추가**(5장). 한투 재무·뉴스 API는 `core/kis`에서 실제로 확인 |
| S3 | TradingAgents의 출력 언어 설정 여부 | 한국어 요약 단계 추가 | ✅ `output_language` 있음. 일부 애널리스트 보고서는 영어 |
| S4 | 최종 결정값 체계(BUY/HOLD/SELL 또는 등급) | UI 배지 정의를 맞춤 | ✅ 5단계 등급 + REVIEW |
| S5 | 체크포인트로 이어서 실행 | 실패 시 처음부터 다시 실행 | ✅ 끝난 단계를 건너뛰고 이어짐 |
| S6 | 노드 단위 진행 스트리밍을 받는 방법 | 단계별 대신 시작·완료만 표시 | ✅ `graph.stream(subgraphs=True)` |
| S7 | **Windows에서 TradingAgents를 포함한 PyInstaller onedir 빌드와 실행** (CI Windows 러너) | 숨은 import 보정, 안 되면 내장 Python과 첫 실행 시 의존성 설치 방식으로 전환 | ✅ 추가 옵션 없이 성공(123.8MB, 시작 3.1초) |
| S8 | 혼합 프리셋(로컬 quick + 클라우드 deep)이 동작하는지 | 프리셋에서 혼합 제거 | ✅ 동작(이 PC에서 38.6분으로 가장 느림). 프리셋 유지, 8GB 기본값으로는 쓰지 않음 |

한투 관련 미검증 항목(공식 호출 한도, 토큰 수치, 해외 지수·뉴스 API, 미국 실시간 수신 범위)은 키가 필요하므로 `core/kis` 첫 작업에서 확인한다.

---

## 14. 설계 섹션 ↔ 브랜치 ↔ 단계 대응표

| 이 문서의 섹션 | 주 브랜치 | 단계 |
|---|---|---|
| 2 아키텍처 | `core/foundation`, `shell/tauri` | 3, 4 |
| 3 LLM | `core/llm` | 3 |
| 4 알림 | `core/alerts` | 3 |
| 5 분석 | `core/analysis` | 3 |
| 6 브리핑 | `core/briefing` | 3 |
| 7 한투 연동 | `core/kis` | 3 |
| 8 오류 처리 | 전 브랜치 (형식은 `core/foundation`) | 3, 4 |
| 9 화면 | `ui/design-system`, `ui/screens` | 4 |
| 10 테스트 | 전 브랜치 + CI | 전체 |
| 11 빌드·배포 | `infra/release` | 5 |
| 12 개발 방식 | `main` (`.claude/`, `.github/`) | 1 |
| 13 검증 실험 | `spike/tradingagents-local-llm` | 2 |

## 15. 용어
- **단계:** 진행 순서. 1 설계, 2 검증 실험, 3 사이드카, 4 셸·UI, 5 배포.
- **1차·2차 버전:** 기능 범위.
- **사이드카:** Tauri 앱이 함께 실행하는 Python 백엔드 프로세스(`vater-core`).
- **프리셋:** LLM 조합 설정(클라우드 전용 / 로컬 전용 / 혼합).
- **quick_think / deep_think:** TradingAgents의 두 LLM 등급. 빠른 처리용과 깊은 추론용.
