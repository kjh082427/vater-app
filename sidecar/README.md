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

## API (현재)
`GET /health` · `POST /shutdown` · `GET/PATCH /settings` · `GET /secrets` · `PUT/DELETE /secrets/{name}` · `GET /events` (SSE) · `GET /symbols/search?q=` · `POST /settings/kis/test`

## 테스트와 검사
```bash
uv run pytest -q                    # 실제 키·LLM이 필요한 테스트는 기본 제외 (kis_live, llm)
uv run pytest -m kis_live -q -s     # 한투 실연동 (루트 .env 키 읽기, 토큰 캐시 ~/.local/share/vater/dev-kis-cache.env)
uv run ruff check . && uv run ruff format --check . && uv run mypy src tests
UPDATE_SNAPSHOTS=1 uv run pytest tests/test_openapi_snapshot.py   # API를 의도적으로 바꿨을 때
```
- `tests/test_readonly_guarantee.py`: 주문·정정·취소 API를 부르는 코드가 생기면 실패한다. 앱은 주문하지 않는다.
