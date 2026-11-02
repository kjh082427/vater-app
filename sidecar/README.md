# vater-core (사이드카)

Vater 데스크톱 앱이 함께 실행하는 **Python 백엔드**입니다. Tauri 셸이 실행하고, React UI는 HTTP와 SSE로 이 서버와 통신합니다. 설계는 [스펙 2장](../docs/superpowers/specs/2026-11-02-vater-mvp-design.md)을 보세요.

## 실행
```bash
cd sidecar
uv sync
VATER_TOKEN=dev VATER_DEV=1 VATER_ENV_FILE=../.env uv run python -m vater_core
# stdout 첫 줄: {"type": "ready", "port": 54321}
curl -H "Authorization: Bearer dev" http://127.0.0.1:54321/health
```

## 환경변수
| 이름 | 필수 | 설명 |
|---|---|---|
| `VATER_TOKEN` | ✅ | 일회용 인증 토큰. Tauri가 실행할 때마다 새로 만든다. 없으면 실행이 거부된다 |
| `VATER_DATA_DIR` | | 데이터 폴더. 기본값은 Windows `%APPDATA%\Vater`, 그 외 `~/.local/share/vater` |
| `VATER_DEV` | | `1`이면 개발 모드 (CORS에 `http://localhost:5173` 허용) |
| `VATER_SECRET_BACKEND` | | `keyring`(Windows 기본) 또는 `envfile`(그 외 기본) |
| `VATER_ENV_FILE` | | envfile 백엔드가 쓰는 파일. 기본 `./.env`. 개발 중에는 `../.env`(저장소 루트, git 제외) |
| `VATER_BACKGROUND_JOBS` | | `0`이면 백그라운드 작업(종목 마스터 갱신 등)을 띄우지 않는다. 테스트용 |

## 구조
| 폴더 / 파일 | 역할 |
|---|---|
| `src/vater_core/__main__.py` | 진입점. 127.0.0.1 빈 포트에 바인딩하고 `ready` 이벤트로 포트를 알린다 |
| `src/vater_core/config.py` | 환경변수 → 실행 설정 |
| `src/vater_core/stdout_events.py` | stdout 이벤트(`ready`, `notify`, `log`). stdout은 이벤트 전용이다 |
| `src/vater_core/logging_setup.py` | 파일 로그(5MB × 5). 비밀키·토큰 마스킹 |
| `src/vater_core/api/` | FastAPI 앱, 토큰 인증, CORS, 오류 형식 `{code, message, hint}`, SSE 이벤트 버스 |
| `src/vater_core/store/` | SQLite 연결, 순차 마이그레이션(`migrations/NNN_*.sql`), 설정 |
| `src/vater_core/secrets/` | 비밀키 저장(keyring / envfile). 값을 돌려주는 API는 없다 |
| `src/vater_core/kis/` | 한국투자증권 연동(**조회 전용**) — 아래 표 |
| `src/vater_core/llm/` | LLM 엔진 관리(하드웨어, 카탈로그, Ollama, 프리셋) — 아래 표 |
| `src/vater_core/analysis/` | AI 종목 분석(TradingAgents 실행, 작업 큐, 국내 데이터 공급자 `kis`) — 아래 표 |

### `kis/` 한국투자증권 연동
| 파일 | 역할 |
|---|---|
| `config.py` | 실전/모의 서버, 호스트, 자격 증명, 호출 우선순위(알림 > 브리핑 > 마스터) |
| `auth.py` | 접근 토큰·WS 승인키. **발급마다 알림톡이 가므로** 비밀키 저장소+메모리에 캐시, 만료 1시간 전 재발급, 동시 요청은 1회 발급 |
| `ratelimit.py` | 우선순위 초당 호출 제한 |
| `client.py` | REST GET 전용 클라이언트: 공통 헤더, `EGW00201` 재시도, 토큰 만료 1회 재발급, 오류 변환 |
| `quotes.py` | 국내·해외 현재가, 일봉(100행 넘으면 이어 받기), 국내 휴장일 |
| `fundamentals.py` | 국내 재무제표·재무비율·뉴스 제목 (국내 분석 공급자용) |
| `market.py` | 지수, 업종(상승·하락 종목 수), 등락률·거래대금 순위, 투자자 수급, 해외 지수(SPX/COMP/NDX) |
| `ws.py` | 실시간 체결(국내 H0STCNT0, 미국 HDFSCNT0), PINGPONG, 재연결·재구독, 구독 한도 |
| `master.py` | 종목 마스터 다운로드·파싱·검색 (`symbols` 테이블) |
| `services.py` | 현재 키·설정으로 부품 조립. 키·서버·한도가 바뀌면 자동 재조립 |

실연동으로 확인한 사실(필드 위치, 정렬 코드, 단위 등)은 [`docs/kis-live-findings.md`](../docs/kis-live-findings.md)에 있다.

### `llm/` LLM 엔진 관리
| 파일 | 역할 |
|---|---|
| `catalog.json`, `catalog.py` | 하드웨어 등급(NVIDIA 24GB·12GB·8GB, 내장 GPU)별 기본 프리셋과 추천 모델, 로컬 모델 5개, 클라우드 제공자 4개. 기본값의 근거는 검증 실험 보고서 |
| `hardware.py` | `nvidia-smi`(5초 제한)와 RAM으로 등급을 정한다. 실패하면 내장 GPU로 본다 |
| `ollama.py` | Ollama 상태·시작·모델 받기·`num_ctx` 고정 변형(`<tag>-16k`)·삭제. 꺼져 있는 것은 오류가 아니라 상태다 |
| `install.py` | 공식 `OllamaSetup.exe`를 받아 **Authenticode 서명을 확인한 뒤에만** 실행하고, 켜질 때까지 기다린다(Windows) |
| `presets.py` | 프리셋(cloud/local/mixed) → TradingAgents 설정 덮어쓰기 + 환경변수. **API 키는 환경변수로만** 넘긴다 |
| `cloud.py` | 클라우드 키 연결 테스트(토큰을 쓰지 않는 모델 목록 API, 키는 헤더로만) |
| `state.py` | 진행 중인 모델 받기·설치 작업, 하드웨어 감지 캐시 |

진행 이벤트(SSE): `llm.pull` `{tag, status, completed, total, percent}` → `done`/`error`, `llm.install` `{stage: download|verify|launch|waiting|done|error}`

### `analysis/` AI 종목 분석
| 파일 | 역할 |
|---|---|
| `symbols.py` | 종목 → TradingAgents 티커(코스피 `.KS`, 코스닥 `.KQ`), 국내는 소셜 애널리스트 제외 |
| `kis_vendor.py` | **국내 종목용 데이터 공급자 `kis`**: 한투 일봉·기술 지표(stockstats)·재무·뉴스 제목. 워커 스레드에서 이벤트 루프의 한투 클라이언트를 부른다 |
| `engine.py` | TradingAgents 실행 경계(체크포인트, 노드 스트림, 결정). TradingAgents는 이 파일과 `kis_vendor.py`에서만 import한다 |
| `queue.py` | 한 번에 1건씩 처리하는 작업 큐. 시작 전 확인, 취소, 다시 시도, 완료 알림. 엔진은 daemon 스레드에서 돈다 |
| `store.py`, `models.py` | `analyses` 테이블, 엔진·큐·저장소가 함께 쓰는 형식 |
| `summary.py` | 최종 결정문 → 결정 배지(6개), 3줄 요약, 목표가, 기간 |

진행 이벤트(SSE): `analysis.status` `{id, status, decision?, error?}`, `analysis.progress` `{id, stage, node, elapsed_sec}` (stage: analysts → research → trader → risk → portfolio)

## API (현재)
`GET /health` · `POST /shutdown` · `GET/PATCH /settings` · `GET /secrets` · `PUT/DELETE /secrets/{name}` · `GET /events` (SSE) · `GET /symbols/search?q=` · `POST /settings/kis/test`

분석: `POST /analyses` · `GET /analyses?market=&code=` · `GET /analyses/{id}` · `POST /analyses/{id}/cancel` · `POST /analyses/{id}/retry`

LLM: `GET /llm/hardware` · `GET /llm/catalog` · `GET /llm/ollama/status` · `POST /llm/ollama/start` · `POST /llm/ollama/install` · `POST /llm/models/{tag}/pull` · `DELETE /llm/models/{tag}` · `GET /llm/check?preset=` · `POST /settings/llm/test?provider=`

## 테스트와 검사
```bash
uv run pytest -q                    # 실제 키·LLM이 필요한 테스트는 기본 제외 (kis_live, llm)
uv run pytest -m kis_live -q -s     # 한투 실연동 (루트 .env 키 읽기, 토큰 캐시 ~/.local/share/vater/dev-kis-cache.env)
uv run pytest -m llm tests/llm_live -q -s   # GPU·Ollama·클라우드 키 실연동 (없으면 skip)
uv run pytest -m llm tests/analysis_live -q -s   # 실제 분석 2건(국내·미국, Gemini + 한투), 약 30분
uv run ruff check . && uv run ruff format --check . && uv run mypy src tests
UPDATE_SNAPSHOTS=1 uv run pytest tests/test_openapi_snapshot.py   # API를 의도적으로 바꿨을 때
```
- `tests/test_readonly_guarantee.py`: 주문·정정·취소 API를 부르는 코드가 생기면 실패한다. 앱은 주문하지 않는다.
