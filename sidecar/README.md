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

## API (현재)
`GET /health` · `POST /shutdown` · `GET/PATCH /settings` · `GET /secrets` · `PUT/DELETE /secrets/{name}` · `GET /events` (SSE)

## 테스트와 검사
```bash
uv run pytest -q                    # 실제 키·LLM이 필요한 테스트는 마커로 제외됨 (kis_live, llm)
uv run ruff check . && uv run ruff format --check . && uv run mypy src tests
UPDATE_SNAPSHOTS=1 uv run pytest tests/test_openapi_snapshot.py   # API를 의도적으로 바꿨을 때
```
- `tests/test_readonly_guarantee.py`: 주문·정정·취소 API를 부르는 코드가 생기면 실패한다. 앱은 주문하지 않는다.
