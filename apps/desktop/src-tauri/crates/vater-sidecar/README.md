# vater-sidecar

Vater 셸이 Python 사이드카(`vater-core`)를 실행·감시·재시작·종료하는 순수 Rust 라이브러리입니다.
Tauri에 의존하지 않아서 어느 운영체제에서나 `cargo test`로 확인할 수 있습니다.
Tauri 앱 크레이트(`apps/desktop/src-tauri`)가 경로 의존성으로 쓰고, 같은 Cargo 워크스페이스(잠금 파일은 `src-tauri/Cargo.lock`)에 들어 있습니다.

근거: 설계 스펙 2-1(프로세스 수명), 2-2(통신), 계획서 `docs/superpowers/plans/2026-11-03-shell-tauri.md` Task 1~4.

## 모듈

| 모듈      | 하는 일                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `events`  | 사이드카 stdout 한 줄(JSON)을 `SidecarEvent`(`Ready{port}`, `Notify{title, body, route}`, `Log`, `Unknown`)로 해석합니다. 빈 줄, JSON이 아닌 줄, 형식이 틀린 이벤트, 범위 밖 포트, 깨진 UTF-8은 `None`으로 돌려주고 건너뜁니다.                                                                                                                                                                                                                                |
| `restart` | 재시작 정책입니다. 최근 10분 안의 비정상 종료가 3회를 넘으면 `GiveUp`, 아니면 1·2·4초 백오프로 `Restart`합니다. `ready`를 받으면 백오프만 처음으로 돌아갑니다.                                                                                                                                                                                                                                                                                                 |
| `launch`  | 실행 명령을 만듭니다. 운영은 `<resources>/vater-core/vater-core.exe`, 개발은 `sidecar/`에서 `uv run python -m vater_core`(`VATER_DEV=1`)입니다. `VATER_TOKEN`을 넘기고 stdout은 파이프, stdin은 닫고, Windows에서는 콘솔 창을 숨깁니다(`CREATE_NO_WINDOW`). `new_token()`은 32바이트 난수의 16진수 64자입니다.                                                                                                                                                 |
| `process` | `SidecarManager`입니다. 실행할 때마다 새 토큰으로 띄우고, `ready`면 `Ready{port, token}`, `notify`·`log`는 콜백으로 넘깁니다. `ready`가 30초 안에 오지 않거나 요청하지 않은 종료면 재시작 정책을 따르고, 넘으면 `Failed`에서 멈춥니다. `shutdown()`은 `POST /shutdown` 뒤 5초 안에 끝나지 않으면 강제 종료합니다. 상태는 `info()`와 `subscribe()`로 읽고, `post_json(path)`은 `Ready`인 사이드카에 토큰을 붙여 요청합니다(토큰이 크레이트 밖으로 나가지 않음). |

## 쓰는 법 (`src-tauri/src/lib.rs`가 하는 일)

```rust
use vater_sidecar::{launch, process::{ManagerConfig, SidecarManager}};

let manager = SidecarManager::start(
    &tokio_handle,
    move |token| launch::command(mode, &resource_dir, &repo_sidecar, token),
    |event| { /* Notify → Windows 알림, Log → 셸 로그 */ },
    ManagerConfig::default(), // ready 30초, 종료 유예 5초, 10분에 3회
);
let info = manager.info();      // get_sidecar_info로 UI에 넘긴다
let outcome = manager.shutdown().await; // 트레이 "종료"
```

## 지키는 것

- 토큰은 메모리에만 둡니다. `SidecarInfo`의 `{:?}` 출력은 토큰을 가립니다. `std::process::Command`의 `{:?}`는 환경변수(토큰)를 보여 주므로 로그에 쓰지 않습니다.
- `VATER_DATA_DIR`는 넘기지 않습니다(사이드카가 `%APPDATA%\Vater`를 씁니다). 운영 모드는 사용자 환경에 남은 `VATER_DEV`를 지웁니다.
- 사이드카로 보내는 HTTP 요청은 127.0.0.1로만 가고 프록시를 쓰지 않습니다.
- 알려진 한계: Linux 개발 모드에서 강제 종료하면 `uv`만 끝나고 그 아래 `python`이 남을 수 있습니다(정상 종료는 문제없음). 운영의 onedir `vater-core.exe`는 프로세스 하나라서 해당하지 않습니다.

## 확인 방법

Rust는 `~/.cargo/bin`에 있고 PATH에 넣지 않았으므로 직접 부릅니다.

```bash
cd apps/desktop/src-tauri   # 워크스페이스 루트
~/.cargo/bin/cargo fmt --all --check
~/.cargo/bin/cargo clippy --locked -p vater-sidecar --all-targets -- -D warnings
~/.cargo/bin/cargo test --locked -p vater-sidecar
# 실제 사이드카로 ready → GET /health 200 → 종료 코드 0 (uv와 저장소의 sidecar/ 필요, 처음에는 가상환경을 만듭니다)
~/.cargo/bin/cargo test --locked -p vater-sidecar --test process -- --ignored --nocapture
# Windows용 코드(CREATE_NO_WINDOW)가 컴파일되는지 (링크 없이 검사만)
~/.cargo/bin/cargo clippy --locked -p vater-sidecar --target x86_64-pc-windows-msvc --all-targets -- -D warnings
```

- `tests/process.rs`는 가짜 사이드카 `tests/fixtures/fake_sidecar.py`(표준 라이브러리만)를 실제로 띄워 ready, notify, 쓰레기 줄, 즉시 종료 4회 → `Failed`, ready 시간 초과, ready 뒤 비정상 종료 → 새 토큰으로 재시작, 정상 종료, 종료 요청 무시 → 유예 뒤 강제 종료, drop, `post_json`(트레이의 감시 일시 중지·재개)을 확인합니다. 시간 제한은 짧게 줄여 씁니다.
- Python 실행 파일은 `VATER_TEST_PYTHON`으로 바꿀 수 있습니다(기본: Windows `python`, 그 밖 `python3`).
- 크레이트 버전은 배포된 지 2주가 지난 것으로 고정했습니다(`Cargo.toml`은 `=` 고정, `Cargo.lock`의 간접 의존성도 같은 기준).
