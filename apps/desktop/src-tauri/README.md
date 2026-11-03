# Vater 셸 (Tauri 2)

`Vater.exe`입니다. 창·트레이·단일 인스턴스·부팅 시 자동 실행·Windows 알림을 맡고, Python 사이드카(`vater-core`)를 실행·감시·재시작·종료합니다.
근거: 설계 스펙 2-1, 2-2, 9-1, 11과 계획서 `docs/superpowers/plans/2026-11-03-shell-tauri.md`.

## UI와의 계약 (ui/screens 브랜치가 쓰는 것)

`src/platform/` 어댑터에서 `@tauri-apps/api`로 부릅니다. 셸은 이 형식을 바꾸지 않습니다.

### 커맨드

| 커맨드             | 인자                   | 돌려주는 값                                                                                |
| ------------------ | ---------------------- | ------------------------------------------------------------------------------------------ |
| `get_sidecar_info` | 없음                   | `{ state: "starting" \| "ready" \| "failed" \| "stopped", port?: number, token?: string }` |
| `get_autostart`    | 없음                   | `boolean` (부팅 시 자동 실행이 켜져 있는지)                                                |
| `set_autostart`    | `{ enabled: boolean }` | `boolean` (바뀐 뒤의 상태). 실패하면 오류 문자열                                           |

- `port`와 `token`은 `state`가 `"ready"`일 때만 있습니다. UI는 모든 요청에 `Authorization: Bearer <token>`을 붙이고, `GET /events`(SSE)만 `?token=`을 씁니다(스펙 2-1).
- `"starting"`: 시작 중이거나 비정상 종료 뒤 다시 시작하는 중입니다. `"failed"`: 10분 안에 3회를 넘게 죽어 재시작을 멈췄습니다. 오류 화면을 보여 주세요. `"stopped"`: 앱이 끝나는 중입니다.

### 이벤트

| 이벤트          | 내용                           | 언제                                                                                                        |
| --------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `sidecar-state` | `get_sidecar_info`와 같은 형식 | 사이드카 상태가 바뀔 때마다. 재시작하면 포트와 토큰이 **둘 다** 바뀌므로 이 이벤트를 받으면 다시 연결합니다 |
| `navigate`      | `{ route: string }`            | 사용자가 Windows 알림을 눌렀을 때(알림에 화면 경로가 있을 때만). 셸이 창을 먼저 띄웁니다                    |

- 앱이 시작될 때 사이드카는 이미 `starting`일 수 있습니다. UI는 먼저 `get_sidecar_info`를 부르고, 그다음 `sidecar-state`를 구독합니다.
- 알림 클릭은 Windows에서 알림이 화면에 떠 있는 동안만 전달됩니다. 알림 센터로 넘어간 알림을 누르면 앱이 앞으로 오지 않을 수 있습니다(`tauri-plugin-notification`의 한계).

### 보안 설정

- CSP(운영): `default-src 'self'`, 스타일은 `'unsafe-inline'` 허용, 이미지·글꼴은 `data:` 허용, `connect-src`는 `'self'`, IPC(`ipc:`, `http://ipc.localhost`), 사이드카 `http://127.0.0.1:*`입니다. 화면에서 다른 출처가 필요하면 `tauri.conf.json`의 `app.security.csp`를 함께 고칩니다.
- 개발(`tauri dev`)은 Vite(`http://localhost:5173`, HMR 웹소켓, 인라인 스크립트)를 위해 `devCsp`를 느슨하게 둡니다.
- 권한(`capabilities/default.json`)은 `core:default`만 줍니다. 알림·자동 실행은 셸(Rust)이 처리하므로 UI에 플러그인 권한을 주지 않습니다.

## 하는 일

| 파일                    | 내용                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib.rs`            | Tauri 연결: 플러그인(단일 인스턴스 → 알림 → 자동 실행), 창 닫기 → 트레이로 숨김(처음 한 번 안내 알림), 트레이 메뉴, 사이드카 시작, 상태 이벤트, 종료 정리     |
| `src/commands.rs`       | 위 커맨드와 이벤트 형식(`SidecarInfoDto`, `NavigatePayload`)                                                                                                  |
| `src/tray.rs`           | 트레이 메뉴 글자(`감시 일시 중지` ↔ `감시 재개`)와 사이드카 경로(`POST /alerts/pause` ↔ `/alerts/resume`), 응답 해석                                          |
| `src/notify.rs`         | 알림의 화면 경로(`extra.route`), "Vater는 트레이에서 계속 실행됩니다" 안내를 한 번만 보이는 표시(앱 설정 폴더의 `tray-notice-shown`)                          |
| `src/startup.rs`        | 사이드카 실행 방식(디버그 빌드 = 저장소 `sidecar/`에서 `uv run`, 릴리스 빌드 = 함께 설치된 `vater-core.exe`), 자동 실행 인자 `--autostart`(트레이에서만 시작) |
| `crates/vater-sidecar/` | 사이드카 실행·감시·재시작·종료 로직(Tauri 없이 테스트). 자세한 내용은 그 폴더의 README                                                                        |

- 트레이 "종료"는 창을 숨기고 사이드카에 `POST /shutdown`을 보낸 뒤 5초 안에 끝나지 않으면 강제 종료하고 앱을 끝냅니다. 다른 경로로 앱이 끝나도(`RunEvent::Exit`) 같은 정리를 합니다.
- 감시 일시 중지 상태는 사이드카 메모리에만 있으므로, 사이드카가 다시 시작되면 트레이 메뉴도 `감시 일시 중지`로 돌아갑니다. 사이드카가 준비되기 전에는 이 메뉴를 누를 수 없습니다.
- 아이콘(`icons/`)은 **임시**입니다. DESIGN.md의 ink(`#141414`) 사각형에 흰 "V"를 그린 `icons/app-icon.svg`에서 `npx @tauri-apps/cli@2.12.3 icon icons/app-icon.svg`로 만들고, 모바일용 폴더(`android/`, `ios/`)는 지웠습니다.

## 설정 파일

- `tauri.conf.json`: 이름 `Vater`, 식별자 `com.kjh082427.vater`, 창 1280×800(최소 1024×600), 프런트엔드 `../dist`, 개발 서버 `http://localhost:5173`, NSIS `currentUser` 설치(관리자 권한 없음), WebView2는 부트스트래퍼로 설치합니다.
- `tauri.windows.conf.json`: 설치 파일에 넣는 사이드카 폴더(`sidecar/dist/vater-core` → 설치 폴더의 `vater-core/`). Windows에서만 합쳐집니다. Linux의 `cargo test`가 PyInstaller 결과물 없이 돌아가게 하려고 따로 두었습니다. 그래서 **Windows에서 빌드하려면 먼저 PyInstaller로 `sidecar/dist/vater-core/`를 만들어야 합니다**(만드는 명령은 `.github/workflows/desktop.yml`).

## 빌드와 확인

### Linux(WSL)에서

Rust는 `~/.cargo/bin`에 있고 PATH에 넣지 않았으므로 직접 부릅니다. WSL에는 Tauri가 쓰는 webkit2gtk-4.1, gtk3, libsoup3, ayatana-appindicator, xdo가 설치되어 있습니다.

```bash
cd apps/desktop/src-tauri
~/.cargo/bin/cargo fmt --check
~/.cargo/bin/cargo clippy --locked --workspace --all-targets -- -D warnings
~/.cargo/bin/cargo test --locked --workspace
# 실제 사이드카로 ready → /health 200 → 종료 코드 0
~/.cargo/bin/cargo test --locked -p vater-sidecar --test process -- --ignored --nocapture
# 창 띄워 보기(WSLg): Vite 개발 서버 + 디버그 빌드 + 저장소 사이드카(uv run)
cd .. && PATH=$HOME/.cargo/bin:$PATH npx @tauri-apps/cli@2.12.3 dev
```

- `cargo clippy --target x86_64-pc-windows-msvc`는 `vater-sidecar`만 됩니다. 앱 크레이트는 빌드 스크립트가 Windows 아이콘 리소스를 만들 때 `llvm-rc`가 필요해서 WSL에서는 검사하지 못하고, Windows CI에서 검사합니다.
- `tauri dev`의 사이드카는 개발 모드라서 데이터는 `~/.local/share/vater`, 비밀키는 `sidecar/.env`를 씁니다.

### Windows CI (`.github/workflows/desktop.yml`)

`apps/desktop/**`, `sidecar/**`, 워크플로가 바뀐 PR과 `main`·`shell/**`·`infra/**` push에서 `windows-latest`로 돕니다.

1. `packaging/build-sidecar.ps1`: `uv sync --locked --no-dev` 뒤 PyInstaller 6.22.3(`uv run --with`, `sidecar/pyproject.toml`과 `uv.lock`은 그대로)으로 `sidecar/dist/vater-core/vater-core.exe`(onedir, 콘솔 앱)를 만듭니다.
2. `packaging/smoke-sidecar.ps1`: 그 exe를 `VATER_TOKEN`, `VATER_BACKGROUND_JOBS=0`, 임시 데이터 폴더, `VATER_SECRET_BACKEND=envfile`로 띄워 `ready` → `GET /health` 200 → `POST /shutdown` 202 → 종료 코드 0을 확인합니다.
3. `cargo clippy`, `cargo test`(가짜 사이드카로 Windows 프로세스 동작까지) → `npx @tauri-apps/cli@2.12.3 build --bundles nsis`.
4. 설치 파일을 산출물 **`vater-windows-installer`**로 올립니다(14일 보관). Actions 실행 화면의 Artifacts에서 받습니다.
5. `packaging/smoke-installed.ps1`: 설치 파일을 `/S`로 조용히 설치하고 `Vater.exe`를 띄워, 함께 설치된 `vater-core.exe`가 `Vater.exe`의 자식으로 127.0.0.1에서 요청을 받는지(토큰 없이 `/health` → 401) 확인합니다.

첫 성공 실행([41576477065](https://github.com/kjh082427/vater-app/actions/runs/41576477065)): 사이드카 onedir 146.9MB, `Vater.exe` 12.2MB, 설치 파일 `Vater_0.1.0_x64-setup.exe` 55.8MB, 설치 후 `vater-core.exe`가 9.6초 만에 요청을 받음.

### Windows에서 직접 빌드할 때

```powershell
./apps/desktop/src-tauri/packaging/build-sidecar.ps1     # sidecar/dist/vater-core/ (설치 파일과 Windows 빌드에 필요)
cd apps/desktop; npm ci; npx @tauri-apps/cli@2.12.3 build --bundles nsis
```

## Windows 수동 확인 목록

CI 산출물 `vater-windows-installer`의 설치 파일을 받아 확인합니다. 서명하지 않았으므로 SmartScreen("Windows PC 보호")이 뜨면 "추가 정보 → 실행"을 누릅니다(스펙 11). 결과는 PR에 적습니다.

| #   | 할 일                                                                           | 기대 결과                                                                                                 |
| --- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | 설치 파일 실행                                                                  | 관리자 권한 묻지 않고 `%LOCALAPPDATA%\Vater`에 설치. WebView2가 없으면 함께 설치                          |
| 2   | 시작 메뉴에서 Vater 실행                                                        | 창(1280×800)이 뜨고, 작업 관리자에서 `Vater.exe` 아래에 `vater-core.exe`가 하나 보임. 콘솔 창은 뜨지 않음 |
| 3   | 창을 최소 크기까지 줄이기                                                       | 1024×600보다 작아지지 않음                                                                                |
| 4   | 창의 X 누르기                                                                   | 창이 사라지고 트레이 아이콘이 남음. 처음 한 번만 "Vater는 트레이에서 계속 실행됩니다" 알림                |
| 5   | 다시 열고 X를 한 번 더                                                          | 이번에는 알림이 뜨지 않음(앱을 다시 시작해도)                                                             |
| 6   | 트레이 아이콘 왼쪽 클릭, 또는 메뉴 "열기"                                       | 창이 다시 앞으로                                                                                          |
| 7   | 트레이 메뉴 "감시 일시 중지"                                                    | 글자가 "감시 재개"로 바뀜. 다시 누르면 "감시 일시 중지"                                                   |
| 8   | Vater를 한 번 더 실행(시작 메뉴)                                                | 새 창이 뜨지 않고 기존 창이 앞으로. `vater-core.exe`는 여전히 하나                                        |
| 9   | 알림이 오는 상황(알림 규칙 발동, 또는 브리핑 도착)에서 알림이 떠 있는 동안 클릭 | 창이 앞으로 오고 해당 화면으로 이동(ui/screens 이후). 알림 센터로 넘어간 뒤 클릭은 동작하지 않을 수 있음  |
| 10  | 작업 관리자에서 `vater-core.exe`만 끝내기                                       | 몇 초 안에 새 `vater-core.exe`가 뜨고 화면이 다시 연결됨                                                  |
| 11  | 10을 10분 안에 4번 반복                                                         | 재시작을 멈추고 UI가 실패 상태(`sidecar-state` = `failed`)를 보임                                         |
| 12  | 트레이 메뉴 "종료"                                                              | 창과 트레이 아이콘이 사라지고, 5초 안에 `Vater.exe`와 `vater-core.exe`가 모두 작업 관리자에서 사라짐      |
| 13  | 첫 실행 마법사(ui/screens 이후)에서 자동 실행 켜고 로그아웃 → 로그인            | Vater가 창 없이 트레이로 시작(`--autostart`). 끄면 다시 시작하지 않음                                     |
| 14  | 설정 → 앱 → Vater 제거                                                          | 설치 폴더가 지워짐(데이터 `%APPDATA%\Vater`는 남음)                                                       |

- 알려진 한계: `Vater.exe`가 비정상 종료되거나 작업 관리자에서 강제로 끝나면 `vater-core.exe`가 남습니다(작업 개체로 묶지 않음). 이 경우 다음 실행 전에 작업 관리자에서 끝내 주세요.
