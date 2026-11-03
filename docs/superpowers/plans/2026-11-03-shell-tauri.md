# shell/tauri 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tauri 2 셸(Vater.exe)이 사이드카를 실행·감시·재시작하고, 창·트레이·단일 인스턴스·자동 실행·Windows 알림을 맡는다. UI에는 `get_sidecar_info`로 포트와 토큰만 넘긴다.

**Architecture:**
- 폴더 `apps/desktop/src-tauri/` (`ui/design-system`이 만든 Vite 앱 `apps/desktop/` 위에 얹는다. 이 브랜치는 그 PR이 main에 들어온 뒤 main을 합치고 시작한다).
- 순수 로직은 Tauri 타입 없이 `src/sidecar/`에 둬서 `cargo test`로 확인한다: stdout 이벤트 해석(`events.rs`), 재시작 정책(`restart.rs`), 실행 명령 만들기(`launch.rs`). Tauri에 붙는 부분(`process.rs`, `tray.rs`, `notify.rs`, `commands.rs`, `lib.rs`)은 얇게 둔다.
- 사이드카 실행: 운영은 Tauri `resources`에 넣은 PyInstaller onedir 폴더 `vater-core/` 안의 `vater-core.exe`를 `std::process::Command`로 직접 실행(Windows는 `CREATE_NO_WINDOW` 0x08000000로 콘솔 창을 숨기고 stdout은 파이프로 받는다). 개발은 `uv run python -m vater_core`(작업 폴더 `sidecar/`, `VATER_DEV=1`).

**Tech Stack:** Rust stable(1.99.1, `~/.cargo/bin/cargo`), Tauri 2, `tauri-plugin-single-instance`, `tauri-plugin-autostart`, `tauri-plugin-notification`(데스크톱 클릭은 `on_action`, Windows는 알림이 화면에 떠 있는 동안만), `serde_json`, `rand`(토큰), `reqwest`(127.0.0.1로 종료·일시 중지 요청). 크레이트 버전은 배포 2주가 지난 것으로 고정한다.

**Spec:** `docs/superpowers/specs/2026-11-02-vater-mvp-design.md` 2-1(프로세스 수명), 2-2(통신), 9-1(트레이 메뉴), 9-3(Tauri API는 `src/platform/` 어댑터 뒤 — 이 브랜치는 Rust 쪽만), 10(Rust 셸: cargo test, Windows CI 빌드), 11(PyInstaller onedir, NSIS currentUser — 설치 파일과 업데이트는 `infra/release`)

## Global Constraints
- 브랜치 `shell/tauri`, 폴더 `apps/desktop/src-tauri/`. 라벨 `area:shell`. Windows 빌드 확인용 워크플로 `.github/workflows/desktop.yml`은 이 브랜치에서 만든다(셸이 Windows에서 컴파일되는지 볼 방법이 그것뿐이라서. 릴리스 워크플로는 `infra/release`).
- 사이드카 계약(바꾸지 않음): 환경변수 `VATER_TOKEN`(일회용, 32바이트 난수의 16진수), `VATER_DATA_DIR`는 넘기지 않음(사이드카가 `%APPDATA%\Vater`를 씀), stdout 한 줄 JSON `ready{port}` · `notify{title, body, route}` · `log{...}`, `POST /shutdown` 202, `POST /alerts/pause|resume`.
- 종료: 사이드카에 `POST /shutdown` → 5초 안에 끝나지 않으면 강제 종료(스펙 2-1).
- 재시작: 비정상 종료면 다시 실행, **10분 안에 3회를 넘으면** 멈추고 UI에 오류 상태(스펙 2-1).
- 창 닫기 = 트레이로 숨김. 처음 숨길 때 한 번 "Vater는 트레이에서 계속 실행됩니다" 알림.
- 트레이 메뉴: 열기 · 감시 일시 중지/재개 · 종료(9-1).
- 단일 인스턴스: 두 번째 실행은 기존 창을 앞으로.
- 비밀키·토큰은 로그에 쓰지 않는다(토큰은 메모리에만).

## Review Focus
1. **사이드카가 `ready` 전에 죽거나 `ready`를 끝내 안 보냄** → 시간 제한(30초) 뒤 재시작 정책으로, UI는 "시작 중/실패" 상태를 받는다. (Task 2, 4)
2. **stdout에 JSON이 아닌 줄·모르는 type·깨진 UTF-8** → 무시하고 계속 읽는다(셸이 죽지 않음). (Task 1)
3. **종료 중 사이드카가 응답하지 않음** → 5초 뒤 강제 종료, 앱 종료가 멈추지 않는다. (Task 4)
4. **재시작이 폭주** → 10분 창에서 3회 초과면 멈춘다, 시간이 지나면 창이 밀려 다시 허용된다. (Task 2)
5. **창을 닫았다 열기 / 두 번 실행** → 사이드카는 하나만, 같은 포트·토큰 유지. (Task 5)

---

### Task 1: stdout 이벤트 해석
**Files:** `src-tauri/src/sidecar/events.rs` / 테스트는 같은 파일 `#[cfg(test)]`
- `enum SidecarEvent { Ready { port: u16 }, Notify { title: String, body: String, route: Option<String> }, Log(serde_json::Value), Unknown }`, `fn parse_line(line: &str) -> Option<SidecarEvent>` (빈 줄·JSON 아님 → None, 모르는 type → Unknown, port 범위 밖 → None)
- [ ] 테스트: 사이드카가 실제로 내는 줄 그대로(`{"type": "ready", "port": 54321}`, notify 한국어, route null), 공백·CRLF, JSON 아님, 모르는 type, port 0/70000 → 구현 → `cargo test` → 커밋 `feat(shell): 사이드카 stdout 이벤트 해석`

### Task 2: 재시작 정책
**Files:** `src-tauri/src/sidecar/restart.rs`
- `struct RestartPolicy { window: Duration(600s), max: 3 }`, `fn on_exit(&mut self, now: Instant) -> Decision { Restart{delay}, GiveUp }` (지수 백오프 1·2·4초), `ready` 받으면 백오프만 초기화
- [ ] 테스트: 3회까지 Restart, 4회째 GiveUp, 10분 지나면 다시 허용, 백오프 증가 → 커밋 `feat(shell): 사이드카 재시작 정책`

### Task 3: 실행 명령
**Files:** `src-tauri/src/sidecar/launch.rs`
- `fn command(mode: Mode, resource_dir: &Path, repo_sidecar: &Path, token: &str) -> std::process::Command` (`Mode::Bundled` → `<resource_dir>/vater-core/vater-core.exe`, `Mode::Dev` → `uv run python -m vater_core` + `VATER_DEV=1`), 공통: `VATER_TOKEN`, stdout 파이프, stdin null, Windows `CREATE_NO_WINDOW`; `fn new_token() -> String`(64자 16진수)
- [ ] 테스트: 프로그램·인자·환경변수·작업 폴더, 토큰 길이·문자·매번 다름 → 커밋 `feat(shell): 사이드카 실행 명령과 일회용 토큰`

### Task 4: 사이드카 관리자
**Files:** `src-tauri/src/sidecar/process.rs`
- `SidecarManager::start(spawn_fn, on_event)`: 실행 → stdout 줄을 읽어 `ready`면 상태 `Ready{port, token}`, `notify`는 콜백, 비정상 종료면 `RestartPolicy`; `ready` 30초 제한; `async fn shutdown(&self)` (POST /shutdown → 5초 → kill); `fn info() -> SidecarInfo { state: Starting|Ready|Failed, port, token }`
- [ ] 테스트(실제 프로세스, Tauri 없이): 가짜 사이드카(작은 Python 스크립트 또는 테스트 바이너리)가 ready 출력 → Ready, notify 줄 → 콜백, 바로 죽음 ×4 → Failed, ready 안 보냄 → 시간 제한 재시작, 종료 요청 무시 → 5초 뒤 kill. 실제 사이드카(`uv run python -m vater_core`)로 ready → `/health` 200 → shutdown 0 (WSL에서 `cargo test -- --ignored`) → 커밋 `feat(shell): 사이드카 실행·감시·재시작·종료`

### Task 5: Tauri 앱(창·트레이·단일 인스턴스·알림·자동 실행)
**Files:** `src-tauri/{Cargo.toml, tauri.conf.json, build.rs, capabilities/default.json, icons/}`, `src/{main.rs, lib.rs, commands.rs, tray.rs, notify.rs}`
- `get_sidecar_info` 커맨드, 창 닫기 → 숨김(첫 1회 알림), 트레이 메뉴(열기 / 감시 일시 중지·재개 → `reqwest`로 사이드카 호출, 메뉴 글자 갱신 / 종료 → shutdown 후 exit), 단일 인스턴스(기존 창 표시·포커스), 자동 실행 플러그인(켜기·끄기 커맨드, 첫 실행 마법사에서 쓰도록), `notify` 이벤트 → Windows 알림, 클릭(`on_action`) → 창 표시 + UI에 `navigate{route}` 이벤트
- `tauri.conf.json`: identifier `com.vater.app`(가칭, PR에서 확정), productName `Vater`, `bundle.resources`에 `../../../sidecar/dist/vater-core/` → `vater-core/`, `bundle.windows.nsis.installMode: currentUser`(번들 설정만, 설치 파일 배포는 infra)
- [ ] 테스트: 트레이 메뉴 문구·상태 전환 로직은 순수 함수로(`menu_label(paused)`), 나머지는 수동 확인 목록과 Windows CI 빌드 → 커밋 `feat(shell): 창·트레이·단일 인스턴스·알림·자동 실행`

### Task 6: Windows CI와 사이드카 PyInstaller
**Files:** `.github/workflows/desktop.yml`, `sidecar/packaging/vater-core.spec`(또는 명령줄)
- `windows-latest`에서: Python 3.13 + uv → `pyinstaller --onedir --name vater-core`(콘솔 앱, stdout 유지) → Node → `npm ci` → `cargo tauri build --no-bundle`(또는 NSIS까지) → 산출물 크기 출력. `shell/*`, `infra/*` PR과 `apps/desktop/src-tauri/**`, `sidecar/**` 변경 때만
- 실행 확인: 빌드한 `vater-core.exe`를 `VATER_TOKEN`으로 띄워 `ready` 줄과 `/health` 200 확인(스모크)
- [ ] 커밋 `ci(shell): Windows에서 사이드카 PyInstaller와 Tauri 빌드 확인`

### Task 7: README와 수동 확인
**Files:** `apps/desktop/src-tauri/README.md`, `docs/TOOLING.md`(Rust 설치 기록)
- 수동 확인 목록(Windows, CI 산출물 또는 로컬 빌드): 실행 → 창, 닫기 → 트레이·첫 알림, 트레이 일시 중지·재개, 두 번 실행 → 기존 창, 알림 클릭 → 창, 종료 → 사이드카까지 종료(작업 관리자), 사이드카 강제 종료 → 자동 재실행
- [ ] 커밋 `docs(shell): 셸 구조와 확인 방법`
