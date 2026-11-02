# core/foundation 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 다른 모든 사이드카 모듈이 올라설 기반을 만든다. 실행 시 포트를 알리고, 토큰으로 인증하고, 오류 형식을 통일하고, SQLite 마이그레이션, 설정, 비밀키 저장, SSE 이벤트 버스, 마스킹 로그, 읽기 전용 보장 테스트, CI를 갖춘다.

**Architecture:** FastAPI 앱을 `create_app(deps)` 팩토리로 만들고, 의존성(설정, DB, 비밀키 저장소, 이벤트 버스)을 `AppDeps`에 모아 주입한다. 테스트는 `httpx.AsyncClient`와 `ASGITransport`로 앱을 직접 호출한다. 실행 진입점(`python -m vater_core`)은 `127.0.0.1:0`에 소켓을 바인딩하고 stdout에 `ready` JSON을 출력한 뒤 uvicorn을 시작한다.

**Tech Stack:** Python 3.13, uv, FastAPI, uvicorn, pydantic v2, sse-starlette, keyring, sqlite3(표준 라이브러리), pytest, pytest-asyncio, httpx, ruff, mypy

**Spec:** `docs/superpowers/specs/2026-11-02-vater-mvp-design.md` (2-1~2-4, 7-4, 8장, 10장)

## Global Constraints
- 브랜치: `core/foundation`, 폴더: `sidecar/`(`src/vater_core/{api,store,secrets}`, 공통 파일, `tests/`), 그리고 `.github/workflows/ci.yml`. PR 라벨: `area:core`
- `requires-python = "==3.13.*"`, 패키지 이름 `vater-core`, import 이름 `vater_core`, src 레이아웃
- 바인딩 주소는 항상 `127.0.0.1`. 다른 주소는 설정으로도 허용하지 않는다
- 오류 응답 본문은 항상 `{"code": str, "message": str, "hint": str | null}`. `message`와 `hint`는 한국어
- 인증: `Authorization: Bearer <VATER_TOKEN>`. `GET /events`만 `?token=`도 허용한다
- CORS 허용 출처: `tauri://localhost`, `http://tauri.localhost`, `https://tauri.localhost`, 그리고 `VATER_DEV=1`일 때만 `http://localhost:5173`
- 데이터 폴더: `VATER_DATA_DIR`가 있으면 그 값, 없으면 Windows는 `%APPDATA%\Vater`, 그 외는 `~/.local/share/vater`
- 비밀키 값은 DB, 로그, 오류 메시지, API 응답에 절대 나타나지 않는다
- 로그: `<data_dir>/logs/vater-core.log`, 5MB마다 새 파일, 5개 보관
- 주문 API는 구현하지 않는다(Task 8의 테스트가 강제한다)
- 실행 명령은 모두 `sidecar/` 폴더 기준으로 `uv run ...`

## Review Focus
1. **브라우저 EventSource는 헤더를 못 붙임** → `/events?token=<정상 토큰>`은 200, 틀린 토큰은 401 (Task 6)
2. **Tauri 출처에서 보낸 CORS 사전 요청(preflight)** → `OPTIONS /settings`에 `Origin: http://tauri.localhost`를 보내면 허용 헤더가 오고, `Origin: http://evil.example`이면 허용 헤더가 없다 (Task 2)
3. **앱을 다시 켜면 마이그레이션이 또 실행됨** → `migrate()`를 두 번 불러도 오류가 없고 버전이 그대로다 (Task 4)
4. **첫 실행이라 데이터 폴더가 없음** → `open_db()`가 폴더를 만든다 (Task 4)
5. **비밀키 값이 오류나 로그로 새어 나감** → 저장된 비밀키 값이 로그 파일과 오류 응답 어디에도 없다 (Task 5, Task 7)

---

### Task 1: 사이드카 프로젝트 골격과 CI

**Files:**
- Create: `sidecar/pyproject.toml`, `sidecar/src/vater_core/__init__.py`, `sidecar/src/vater_core/__main__.py`(빈 `main()` 호출 자리), `sidecar/tests/test_package.py`, `.github/workflows/ci.yml`
- 참고: 개발용 비밀키 파일은 저장소 루트의 `.env`(git 제외)다. 형식은 루트의 `.env.example`을 따른다. 사이드카를 개발 모드로 실행할 때는 `VATER_ENV_FILE=../.env`를 준다

**Interfaces:**
- Produces: `vater_core.__version__: str` (`importlib.metadata`에서 읽고, 없으면 `"0.0.0-dev"`)

- [ ] **Step 1: uv가 없으면 설치한다**(`curl -LsSf https://astral.sh/uv/install.sh | sh`). 그다음 `uv init --package --lib sidecar` 대신 `pyproject.toml`을 직접 쓴다.
  - 의존성: `fastapi`, `uvicorn[standard]`, `pydantic>=2`, `sse-starlette`, `keyring`
  - dev 그룹: `pytest`, `pytest-asyncio`, `httpx`, `ruff`, `mypy`
  - `[tool.pytest.ini_options] asyncio_mode = "auto"`, `testpaths = ["tests"]`, 마커 `kis_live`, `llm`
  - `[tool.ruff] line-length = 100`
  - `[tool.mypy] strict = true`
- [ ] **Step 2: 실패하는 테스트를 쓴다.**

```python
def test_version_is_string():
    import vater_core
    assert isinstance(vater_core.__version__, str) and vater_core.__version__
```

- [ ] **Step 3: 실패를 확인한다.** `uv python install 3.13 && uv sync && uv run pytest tests/test_package.py -v` → FAIL (`__version__` 없음)
- [ ] **Step 4: `__init__.py`에 `__version__`을 구현한다**
- [ ] **Step 5: 통과를 확인한다.** `uv run pytest -v` → PASS, `uv run ruff check . && uv run ruff format --check . && uv run mypy src` → 오류 없음
- [ ] **Step 6: `ci.yml`을 쓴다.** 트리거는 `pull_request`와 `push`(main)이고 `ubuntu-latest`에서 실행한다. 순서는 `astral-sh/setup-uv` → `working-directory: sidecar`에서 `uv sync` → ruff check → ruff format --check → mypy src → `pytest -m "not kis_live and not llm"`
- [ ] **Step 7: 커밋하고 push한다.**

```bash
git add sidecar .github/workflows/ci.yml
git commit -m "feat(core): 사이드카 프로젝트 골격과 CI"
git push -u origin core/foundation
```

### Task 2: 앱 팩토리, 오류 형식, 인증, CORS, /health, /shutdown

**Files:**
- Create: `sidecar/src/vater_core/api/__init__.py`, `api/app.py`, `api/errors.py`, `api/auth.py`, `api/deps.py`, `api/routes/__init__.py`, `api/routes/system.py`, `sidecar/tests/conftest.py`, `sidecar/tests/api/test_system.py`

**Interfaces:**
- Produces:
  - `class VaterError(Exception): __init__(self, code: str, message: str, hint: str | None = None, status: int = 400)`
  - `@dataclass class AppDeps: token: str; dev: bool; data_dir: Path; db: sqlite3.Connection | None = None; secrets: SecretStore | None = None; events: EventBus | None = None; shutdown: Callable[[], None] = lambda: None`. 이후 Task에서 필드를 채운다
  - `create_app(deps: AppDeps) -> FastAPI`
  - `GET /health` → `{"status": "ok", "version": str}`
  - `POST /shutdown` → 202, `deps.shutdown()`을 호출
  - 인증 실패 → 401 `{"code": "AUTH_INVALID", ...}`
  - FastAPI 검증 오류도 422 `{"code": "REQUEST_INVALID", ...}` 형식으로 변환한다. **입력값(`input`)은 응답에 포함하지 않는다**(비밀키가 다시 나오지 않게)
  - `conftest.py` 픽스처: `deps`(tmp 데이터 폴더, 토큰 `"test-token"`), `client`(인증 헤더가 붙은 `httpx.AsyncClient`), `anon_client`(헤더 없음)

- [ ] **Step 1: 실패하는 테스트를 쓴다.**

```python
async def test_health_requires_token(anon_client):
    r = await anon_client.get("/health")
    assert r.status_code == 401
    assert set(r.json()) == {"code", "message", "hint"} and r.json()["code"] == "AUTH_INVALID"

async def test_health_ok(client):
    r = await client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"

async def test_wrong_token_rejected(anon_client):
    r = await anon_client.get("/health", headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401

async def test_shutdown_calls_hook(client, deps):
    called = []
    deps.shutdown = lambda: called.append(True)
    r = await client.post("/shutdown")
    assert r.status_code == 202 and called == [True]

async def test_cors_allows_tauri_origin(anon_client):
    r = await anon_client.options("/health", headers={
        "Origin": "http://tauri.localhost", "Access-Control-Request-Method": "GET"})
    assert r.headers.get("access-control-allow-origin") == "http://tauri.localhost"

async def test_cors_blocks_other_origin(anon_client):
    r = await anon_client.options("/health", headers={
        "Origin": "http://evil.example", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in r.headers

async def test_vater_error_shape(client, app_with_boom_route):
    r = await client.get("/__boom")  # 테스트 전용 라우트가 VaterError("X_TEST", "테스트", "힌트", 409)를 던짐
    assert r.status_code == 409 and r.json() == {"code": "X_TEST", "message": "테스트", "hint": "힌트"}
```

- [ ] **Step 2: 실패를 확인한다.** `uv run pytest tests/api/test_system.py -v` → FAIL (import 오류)
- [ ] **Step 3: 구현한다.**
  - 인증은 라우터 전역 의존성으로 건다. 토큰 비교는 `hmac.compare_digest`를 쓴다
  - CORS 사전 요청(OPTIONS)은 인증 전에 처리되도록 `CORSMiddleware`를 앱 미들웨어로 등록한다
  - `app_with_boom_route` 픽스처는 `conftest.py`에서 `create_app(deps)`에 테스트 라우트를 추가해 만든다
- [ ] **Step 4: 통과를 확인한다.** `uv run pytest -v` → PASS
- [ ] **Step 5: 커밋하고 push한다.** `feat(core): 앱 팩토리, 오류 형식, 토큰 인증, CORS`

### Task 3: 실행 진입점과 stdout 이벤트

**Files:**
- Create: `sidecar/src/vater_core/stdout_events.py`, `sidecar/src/vater_core/config.py`, `sidecar/tests/test_entrypoint.py`, `sidecar/tests/test_stdout_events.py`
- Modify: `sidecar/src/vater_core/__main__.py`

**Interfaces:**
- Produces:
  - `emit(event_type: Literal["ready", "notify", "log"], **payload: Any) -> None`: stdout에 `json.dumps({"type": event_type, **payload}, ensure_ascii=False)` 한 줄을 출력하고 즉시 flush한다. 스레드 잠금으로 줄이 섞이지 않게 한다
  - `notify(title: str, body: str, route: str | None = None) -> None`: `emit("notify", title=..., body=..., route=...)`
  - `load_runtime() -> Runtime`: `@dataclass Runtime(token: str, dev: bool, data_dir: Path)`. `VATER_TOKEN`이 없으면 `SystemExit("VATER_TOKEN is required")`
  - `resolve_data_dir(env: Mapping[str, str], platform: str) -> Path` (Global Constraints의 규칙)
  - `main() -> None`: 소켓 바인딩 → `listen()` → `emit("ready", port=...)` → `uvicorn.Server(...).serve(sockets=[sock])`. `deps.shutdown`은 `server.should_exit = True`

- [ ] **Step 1: 실패하는 테스트를 쓴다.**

```python
def test_resolve_data_dir_windows():
    assert resolve_data_dir({"APPDATA": r"C:\Users\u\AppData\Roaming"}, "win32") == Path(r"C:\Users\u\AppData\Roaming") / "Vater"

def test_resolve_data_dir_override(tmp_path):
    assert resolve_data_dir({"VATER_DATA_DIR": str(tmp_path)}, "linux") == tmp_path

def test_emit_writes_one_json_line(capsys):
    emit("notify", title="삼성전자", body="목표가 도달", route="/alerts/005930")
    line = capsys.readouterr().out.strip()
    assert json.loads(line) == {"type": "notify", "title": "삼성전자", "body": "목표가 도달", "route": "/alerts/005930"}

def test_entrypoint_announces_port_and_serves(tmp_path):
    env = {**os.environ, "VATER_TOKEN": "t0k", "VATER_DATA_DIR": str(tmp_path)}
    p = subprocess.Popen([sys.executable, "-m", "vater_core"], env=env, stdout=subprocess.PIPE, text=True)
    try:
        ready = json.loads(p.stdout.readline())
        assert ready["type"] == "ready" and ready["port"] > 0
        r = httpx.get(f"http://127.0.0.1:{ready['port']}/health", headers={"Authorization": "Bearer t0k"}, timeout=10)
        assert r.status_code == 200
        assert httpx.post(f"http://127.0.0.1:{ready['port']}/shutdown", headers={"Authorization": "Bearer t0k"}).status_code == 202
        assert p.wait(timeout=10) == 0
    finally:
        p.kill()

def test_entrypoint_requires_token(tmp_path):
    env = {k: v for k, v in os.environ.items() if k != "VATER_TOKEN"} | {"VATER_DATA_DIR": str(tmp_path)}
    r = subprocess.run([sys.executable, "-m", "vater_core"], env=env, capture_output=True, text=True, timeout=10)
    assert r.returncode != 0 and "VATER_TOKEN" in r.stderr
```

- [ ] **Step 2: 실패를 확인한다.** `uv run pytest tests/test_entrypoint.py tests/test_stdout_events.py -v` → FAIL
- [ ] **Step 3: 구현한다.** uvicorn에 `log_config=None`을 줘서 stdout에 uvicorn 로그가 섞이지 않게 한다. stdout은 이벤트 전용이다
- [ ] **Step 4: 통과를 확인한다.** `uv run pytest -v` → PASS
- [ ] **Step 5: 커밋하고 push한다.** `feat(core): 실행 진입점(포트 0 바인딩, ready 이벤트)과 stdout 이벤트`

### Task 4: SQLite 저장소, 마이그레이션, 설정 API

**Files:**
- Create: `sidecar/src/vater_core/store/__init__.py`, `store/db.py`, `store/migrations/001_init.sql`, `store/settings.py`, `api/routes/settings.py`, `sidecar/tests/store/test_db.py`, `sidecar/tests/store/test_settings.py`, `sidecar/tests/api/test_settings_api.py`

**Interfaces:**
- Produces:
  - `open_db(data_dir: Path) -> sqlite3.Connection`: 폴더가 없으면 만들고, `vater.db`를 열고, `PRAGMA journal_mode=WAL`, `busy_timeout=5000`, `foreign_keys=ON`을 설정한 뒤 `migrate()`를 호출한다. `check_same_thread=False`
  - `migrate(conn) -> int`: `schema_version` 테이블 기준으로 `migrations/NNN_*.sql`을 번호 순서대로 적용하고 현재 버전을 반환한다
  - `001_init.sql` 테이블(스펙 2-4):
    - `settings(key TEXT PK, value TEXT NOT NULL)`
    - `watchlist(id INTEGER PK, market TEXT CHECK(market IN ('KR','US')), code TEXT, exchange TEXT, name TEXT, created_at TEXT, UNIQUE(market, code))`
    - `alert_rules(id INTEGER PK, watchlist_id INTEGER REFERENCES watchlist ON DELETE CASCADE, kind TEXT, params TEXT, timing TEXT CHECK(timing IN ('realtime','close')), enabled INTEGER, last_state INTEGER, last_fired_at TEXT)`
    - `alert_events(id INTEGER PK, rule_id INTEGER REFERENCES alert_rules ON DELETE SET NULL, fired_at TEXT, value REAL, message TEXT)`
    - `analyses(id INTEGER PK, market TEXT, code TEXT, as_of TEXT, preset TEXT, models TEXT, status TEXT, decision TEXT, summary TEXT, reports TEXT, timings TEXT, tokens TEXT, error TEXT, created_at TEXT)`
    - `briefings(id INTEGER PK, market TEXT, date TEXT, data TEXT, text TEXT, status TEXT, missing TEXT, created_at TEXT, UNIQUE(market, date))`
  - `SETTING_DEFS: dict[str, SettingDef]`. `SettingDef(type: type[bool|int|str], default: Any, choices: tuple | None = None)`. 초기 키는 아래와 같고, 이후 브랜치가 키를 추가한다:
    - `general.autostart` = `True`, `general.close_to_tray` = `True`
    - `kis.server` = `"prod"` (`choices=("prod","vps")`)
    - `llm.preset` = `"cloud"` (`choices=("cloud","local","mixed")`)
    - `analysis.debate_rounds` = `1`
    - `alerts.poll_interval_sec` = `30`
    - `briefing.kr.enabled` = `True`, `briefing.kr.time` = `"16:00"`, `briefing.us.enabled` = `True`, `briefing.us.time` = `"07:00"`
  - `class SettingsRepo: get_all() -> dict[str, Any]; get(key) -> Any; update(changes: dict[str, Any]) -> dict[str, Any]`. 알 수 없는 키는 `VaterError("SETTING_UNKNOWN", ..., status=400)`, 타입이나 선택지가 틀리면 `VaterError("SETTING_INVALID", ..., status=422)`. 시각은 `HH:MM` 형식을 검사한다
  - `GET /settings` → 전체 설정(기본값 포함), `PATCH /settings` 본문 `{key: value}` → 갱신 후 전체 설정

- [ ] **Step 1: 실패하는 테스트를 쓴다.**

```python
def test_open_db_creates_missing_dir(tmp_path):
    conn = open_db(tmp_path / "new" / "dir")
    assert (tmp_path / "new" / "dir" / "vater.db").exists()
    assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"

def test_migrate_is_idempotent(tmp_path):
    conn = open_db(tmp_path)
    v1 = migrate(conn); v2 = migrate(conn)
    assert v1 == v2 == 1

def test_tables_exist(tmp_path):
    names = {r[0] for r in open_db(tmp_path).execute("select name from sqlite_master where type='table'")}
    assert {"settings", "watchlist", "alert_rules", "alert_events", "analyses", "briefings"} <= names

def test_settings_defaults_and_update(tmp_path):
    repo = SettingsRepo(open_db(tmp_path))
    assert repo.get("briefing.kr.time") == "16:00"
    assert repo.update({"briefing.kr.time": "17:30"})["briefing.kr.time"] == "17:30"
    assert SettingsRepo(open_db(tmp_path)).get("briefing.kr.time") == "17:30"  # 다시 열어도 유지

def test_settings_rejects_unknown_and_invalid(tmp_path):
    repo = SettingsRepo(open_db(tmp_path))
    with pytest.raises(VaterError) as e1: repo.update({"nope": 1})
    assert e1.value.code == "SETTING_UNKNOWN"
    with pytest.raises(VaterError) as e2: repo.update({"kis.server": "live"})
    assert e2.value.code == "SETTING_INVALID"
    with pytest.raises(VaterError) as e3: repo.update({"briefing.us.time": "25:00"})
    assert e3.value.code == "SETTING_INVALID"

async def test_patch_settings_api(client):
    r = await client.patch("/settings", json={"analysis.debate_rounds": 2})
    assert r.status_code == 200 and r.json()["analysis.debate_rounds"] == 2
    r = await client.patch("/settings", json={"nope": 1})
    assert r.status_code == 400 and r.json()["code"] == "SETTING_UNKNOWN"
```

- [ ] **Step 2: 실패를 확인한다.** `uv run pytest tests/store tests/api/test_settings_api.py -v` → FAIL
- [ ] **Step 3: 구현한다.** 마이그레이션 SQL 파일은 `importlib.resources`로 읽어서 PyInstaller로 포장해도 동작하게 한다. 값은 JSON 문자열로 저장한다. `conftest.py`의 `deps`에 `db`를 채운다
- [ ] **Step 4: 통과를 확인한다.** `uv run pytest -v` → PASS
- [ ] **Step 5: 커밋하고 push한다.** `feat(core): SQLite 저장소, 마이그레이션, 설정 API`

### Task 5: 비밀키 저장소와 쓰기 전용 API

**Files:**
- Create: `sidecar/src/vater_core/secrets/__init__.py`, `secrets/names.py`, `secrets/store.py`, `api/routes/secrets.py`, `sidecar/tests/secrets/test_store.py`, `sidecar/tests/api/test_secrets_api.py`

**Interfaces:**
- Produces:
  - `class SecretName(StrEnum)`: `KIS_APP_KEY`, `KIS_APP_SECRET`, `KIS_HTS_ID`, `KIS_ACCESS_TOKEN`(캐시용 JSON), `KIS_WS_APPROVAL_KEY`, `LLM_ANTHROPIC_KEY`, `LLM_OPENAI_KEY`, `LLM_GOOGLE_KEY`, `LLM_COMPAT_KEY`, `LLM_COMPAT_BASE_URL`
  - `class SecretStore(Protocol): get(name: SecretName) -> str | None; set(name: SecretName, value: str) -> None; delete(name: SecretName) -> None; known_values() -> list[str]`
  - `KeyringSecretStore(service: str = "Vater")`
  - `EnvFileSecretStore(path: Path)`: `KEY=value` 줄 형식으로 저장하고 파일 권한은 0600
  - `select_secret_store(env: Mapping[str, str], platform: str) -> SecretStore`: `VATER_SECRET_BACKEND`가 `keyring` 또는 `envfile`이면 그것을 쓰고, 없으면 win32는 keyring, 그 외는 envfile(`VATER_ENV_FILE`, 기본 `./.env`)
  - `PUT /secrets/{name}` 본문 `{"value": str}` → 204. 이름이 틀리면 400 `SECRET_NAME_INVALID`, 값이 비었으면 400 `SECRET_VALUE_EMPTY`. **GET 라우트는 없다**
  - `GET /secrets` → `{name: bool}`(설정 여부만), 값은 절대 반환하지 않는다

- [ ] **Step 1: 실패하는 테스트를 쓴다.**

```python
def test_envfile_roundtrip(tmp_path):
    s = EnvFileSecretStore(tmp_path / ".env")
    s.set(SecretName.KIS_APP_KEY, "abc")
    assert EnvFileSecretStore(tmp_path / ".env").get(SecretName.KIS_APP_KEY) == "abc"
    assert oct((tmp_path / ".env").stat().st_mode & 0o777) == "0o600"
    s.delete(SecretName.KIS_APP_KEY)
    assert s.get(SecretName.KIS_APP_KEY) is None

def test_select_store_defaults():
    assert isinstance(select_secret_store({}, "win32"), KeyringSecretStore)
    assert isinstance(select_secret_store({}, "linux"), EnvFileSecretStore)

async def test_put_secret_is_write_only(client, deps):
    r = await client.put("/secrets/KIS_APP_KEY", json={"value": "s3cr3t-value"})
    assert r.status_code == 204
    status = (await client.get("/secrets")).json()
    assert status["KIS_APP_KEY"] is True and "s3cr3t-value" not in json.dumps(status)
    assert (await client.get("/secrets/KIS_APP_KEY")).status_code in (404, 405)

async def test_put_secret_rejects_bad_name_and_empty(client):
    r = await client.put("/secrets/NOPE", json={"value": "leak-me-123"})
    assert r.status_code == 400 and r.json()["code"] == "SECRET_NAME_INVALID"
    assert "leak-me-123" not in r.text                      # 값이 오류 응답에 다시 나오지 않음
    r = await client.put("/secrets/KIS_APP_KEY", json={"value": ""})
    assert r.status_code == 400 and r.json()["code"] == "SECRET_VALUE_EMPTY"

async def test_validation_error_does_not_echo_secret(client):
    r = await client.put("/secrets/KIS_APP_KEY", json={"value": 12345678, "extra": "leak-me-456"})
    assert r.status_code in (400, 422) and "leak-me-456" not in r.text and "12345678" not in r.text
```

- [ ] **Step 2: 실패를 확인한다.** → FAIL
- [ ] **Step 3: 구현한다.** keyring 테스트는 `keyring.backends.fail` 대신 메모리 백엔드를 `keyring.set_keyring()`으로 주입해 실행한다. `conftest.py`의 `deps.secrets`는 tmp 경로의 `EnvFileSecretStore`로 채운다
- [ ] **Step 4: 통과를 확인한다.** `uv run pytest -v` → PASS
- [ ] **Step 5: 커밋하고 push한다.** `feat(core): 비밀키 저장소(keyring/envfile)와 쓰기 전용 API`

### Task 6: 이벤트 버스와 SSE /events

**Files:**
- Create: `sidecar/src/vater_core/api/events.py`, `api/routes/events.py`, `sidecar/tests/api/test_events.py`

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True) class Event: type: str; data: dict[str, Any]; id: int`
  - `class EventBus: publish(type: str, data: dict[str, Any]) -> Event; subscribe() -> AsyncIterator[Event]`. 구독자마다 `asyncio.Queue(maxsize=1000)`를 두고, 가득 차면 가장 오래된 이벤트를 버린다(느린 구독자가 버스를 막지 않게). `id`는 단조 증가
  - `GET /events` (SSE): `event: <type>`, `data: <json>`, `id: <id>`. 15초마다 keep-alive ping. 인증은 헤더 또는 `?token=`

- [ ] **Step 1: 실패하는 테스트를 쓴다.**

```python
async def test_bus_delivers_in_order():
    bus = EventBus()
    sub = bus.subscribe()
    bus.publish("a", {"n": 1}); bus.publish("b", {"n": 2})
    got = [await anext(sub), await anext(sub)]
    assert [e.type for e in got] == ["a", "b"] and got[0].id < got[1].id

async def test_slow_subscriber_drops_oldest():
    bus = EventBus(); sub = bus.subscribe()
    for i in range(1005): bus.publish("t", {"i": i})
    first = await anext(sub)
    assert first.data["i"] == 5

async def test_events_stream_delivers_published_event(live_server):
    url, deps = live_server
    async with httpx.AsyncClient(timeout=5) as c:
        async with c.stream("GET", f"{url}/events?token=test-token") as r:
            assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
            deps.events.publish("alert", {"code": "005930"})
            lines = []
            async for line in r.aiter_lines():
                lines.append(line)
                if line.startswith("data:"): break
    assert "event: alert" in lines and json.loads(lines[-1][5:]) == {"code": "005930"}

async def test_events_endpoint_rejects_bad_query_token(live_server):
    url, _ = live_server
    async with httpx.AsyncClient(timeout=5) as c:
        assert (await c.get(f"{url}/events?token=bad")).status_code == 401
```

`live_server` 픽스처(`conftest.py`에 추가): `uvicorn.Server`를 백그라운드 스레드에서 `127.0.0.1:0`으로 띄우고 `(base_url, deps)`를 돌려준다. 테스트가 끝나면 `should_exit = True`로 종료한다. httpx의 `ASGITransport`는 응답 본문을 다 받은 뒤에 돌려주므로, 끝나지 않는 SSE 스트림은 반드시 실제 서버로 테스트한다.

- [ ] **Step 2: 실패를 확인한다.** → FAIL
- [ ] **Step 3: 구현한다.** `sse-starlette`의 `EventSourceResponse`를 쓴다. `?token=` 허용은 이 라우트 전용 인증 의존성으로만 처리한다
- [ ] **Step 4: 통과를 확인한다.** → PASS
- [ ] **Step 5: 커밋하고 push한다.** `feat(core): 이벤트 버스와 SSE 스트림`

### Task 7: 마스킹 로그

**Files:**
- Create: `sidecar/src/vater_core/logging_setup.py`, `sidecar/tests/test_logging.py`
- Modify: `sidecar/src/vater_core/__main__.py` (실행할 때 `setup_logging` 호출)

**Interfaces:**
- Produces:
  - `setup_logging(data_dir: Path, secret_values: Callable[[], list[str]]) -> None`: 회전 파일 핸들러(5MB, 5개)에 `MaskingFilter`를 단다. stdout에는 로그 핸들러를 달지 않는다
  - `class MaskingFilter(logging.Filter)`: 메시지와 인자를 문자열로 만든 뒤 ① `secret_values()`의 값(길이 4 이상), ② `Bearer \S+`, ③ `"?(appkey|appsecret|access_token|approval_key|api_key|authorization)"?\s*[:=]\s*"?[^"\s,&}]+` 패턴을 `***`로 바꾼다(키 이름은 남긴다)

- [ ] **Step 1: 실패하는 테스트를 쓴다.**

```python
def test_masks_known_secret_and_patterns(tmp_path):
    setup_logging(tmp_path, lambda: ["super-secret-key"])
    log = logging.getLogger("vater_core.test")
    log.info("calling with %s", "super-secret-key")
    log.info('payload {"appsecret": "abcd1234", "x": 1} header Bearer eyJhbGci')
    for h in logging.getLogger().handlers: h.flush()
    text = (tmp_path / "logs" / "vater-core.log").read_text(encoding="utf-8")
    assert "super-secret-key" not in text and "abcd1234" not in text and "eyJhbGci" not in text
    assert "appsecret" in text and "***" in text

def test_rotation_config(tmp_path):
    setup_logging(tmp_path, lambda: [])
    h = next(h for h in logging.getLogger().handlers if isinstance(h, RotatingFileHandler))
    assert h.maxBytes == 5 * 1024 * 1024 and h.backupCount == 5
```

- [ ] **Step 2: 실패를 확인한다.** → FAIL
- [ ] **Step 3: 구현한다.** 테스트끼리 핸들러가 중복되지 않도록 `setup_logging`은 이전에 자기가 붙인 핸들러를 제거하고 다시 붙인다
- [ ] **Step 4: 통과를 확인한다.** → PASS
- [ ] **Step 5: 커밋하고 push한다.** `feat(core): 비밀키 마스킹 회전 로그`

### Task 8: 읽기 전용 보장 테스트와 OpenAPI 스냅샷

**Files:**
- Create: `sidecar/tests/test_readonly_guarantee.py`, `sidecar/tests/test_openapi_snapshot.py`, `sidecar/tests/snapshots/openapi.json`

**Interfaces:**
- Produces: `UPDATE_SNAPSHOTS=1 uv run pytest tests/test_openapi_snapshot.py`로 스냅샷을 갱신하는 규칙. 이후 모든 core 브랜치가 API를 바꿀 때 이 명령으로 스냅샷을 커밋한다

- [ ] **Step 1: 실패하는 테스트를 쓴다.**

```python
ORDER_TR_ID = re.compile(r"\b[TV]TT[A-Z]\d{4}U\b")          # 한투 주문·정정·취소 TR ID(끝자리 U)
ORDER_PATH = re.compile(r"/trading/order")                  # 국내·해외 주문 엔드포인트 경로

def test_no_order_api_in_source():
    src = Path(__file__).parents[1] / "src"
    hits = [f"{p}:{i}" for p in src.rglob("*.py") for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1)
            if ORDER_TR_ID.search(line) or ORDER_PATH.search(line)]
    assert hits == []

def test_guard_patterns_catch_known_order_ids():
    for s in ["TTTC0802U", "VTTC0801U", "TTTT1002U", "/uapi/domestic-stock/v1/trading/order-cash"]:
        assert ORDER_TR_ID.search(s) or ORDER_PATH.search(s)
    for s in ["FHKST01010100", "HHDFS00000300", "TTTC8434R"]:     # 시세·잔고 조회는 통과
        assert not (ORDER_TR_ID.search(s) or ORDER_PATH.search(s))

def test_openapi_snapshot(deps):
    current = create_app(deps).openapi()
    path = Path(__file__).parent / "snapshots" / "openapi.json"
    if os.environ.get("UPDATE_SNAPSHOTS") == "1":
        path.write_text(json.dumps(current, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    assert json.loads(path.read_text(encoding="utf-8")) == current
```

- [ ] **Step 2: 실패를 확인한다.** 스냅샷 파일이 없어서 `test_openapi_snapshot`만 FAIL
- [ ] **Step 3: 스냅샷을 만든다.** `UPDATE_SNAPSHOTS=1 uv run pytest tests/test_openapi_snapshot.py`
- [ ] **Step 4: 통과를 확인한다.** `uv run pytest -v` 전체 PASS, ruff와 mypy 오류 없음
- [ ] **Step 5: 커밋하고 push한다.** `test(core): 주문 API 금지 검사와 OpenAPI 스냅샷`

### Task 9: 브랜치 마무리와 PR

**Files:**
- Modify: `docs/ARCHITECTURE.md` (기반 행의 PR 열), `sidecar/README.md`(Create: 실행 방법, 환경변수 `VATER_TOKEN`, `VATER_DATA_DIR`, `VATER_DEV`, `VATER_SECRET_BACKEND`, `VATER_ENV_FILE`, 테스트 명령)

- [ ] **Step 1: 전체를 검증한다.** `uv run pytest -v && uv run ruff check . && uv run ruff format --check . && uv run mypy src` → 모두 통과. 그리고 직접 실행해 본다: `VATER_TOKEN=dev VATER_DEV=1 uv run python -m vater_core` → 첫 줄에 `{"type": "ready", "port": N}`
- [ ] **Step 2: `superpowers:requesting-code-review`로 브랜치 전체를 리뷰받고 지적 사항을 반영한다**
- [ ] **Step 3: PR을 만든다.** `gh pr create --base main --head core/foundation --label area:core --title "core/foundation: 사이드카 기반"`, 본문은 템플릿 4개 항목. 공부 포인트에는 포트 0 바인딩 방식, 쓰기 전용 비밀키 API, 이벤트 버스의 오래된 이벤트 버림, 마스킹 필터를 쓴다
- [ ] **Step 4: CI 통과를 확인하고 `gh pr merge --merge`로 합친다(브랜치 유지).** 그다음 ARCHITECTURE.md의 PR 열에 PR 번호를 기록한다(main에 `docs:` 커밋)
