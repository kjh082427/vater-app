# 사용한 Claude Code 도구

이 프로젝트에서 쓰는 스킬, 플러그인, MCP 목록입니다. 새로 설치하면 이 표에 추가합니다.

## Claude가 이 프로젝트를 위해 설치한 것

| 날짜 | 도구 | 버전 | 범위 | 출처 | 용도 | 참고 |
|---|---|---|---|---|---|---|
| 2026-11-02 | `impeccable` 플러그인 (+ 마켓플레이스) | 4.8.0 | 프로젝트 (`.claude/settings.json`) | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | UI 품질 점검: critique, audit, polish, PRODUCT.md, DESIGN.md | 훅 3개(세션 시작, 파일 수정 직후, 응답 종료). 처음 실행할 때 GitHub Releases에서 엔진 실행 파일을 받아 sha256으로 검증. 스크립트에서 텔레메트리는 보이지 않음 |
| 2026-11-02 | `taste-skill` 플러그인 (+ 마켓플레이스) | 2.1.5 | 사용자 전체 | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | 앱 화면 아트 디렉션 | Node 22 이상과 Chromium이 필요(브라우저 점검용) |

## 개발 도구 (Claude가 설치)
| 날짜 | 도구 | 버전 | 위치 | 용도 | 참고 |
|---|---|---|---|---|---|
| 2026-11-03 | uv (+ uvx) | 0.13.6 | `~/.local/bin` | Python 버전·의존성 관리 | GitHub Releases 공식 바이너리, sha256 검증 (`curl \| sh` 설치 스크립트는 worktree 격리 규칙 때문에 쓰지 않음) |
| 2026-11-03 | Python | 3.13 | uv 관리 폴더 | 검증 실험·사이드카 실행 | `uv python install 3.13` |
| 2026-11-03 | Ollama 모델 | `qwen3.5:4b`, `qwen3.5:9b` | Windows Ollama | 로컬 LLM 검증 | Ollama 0.40.13은 사용자가 설치 |
| 2026-11-03 | Rust stable (rustup, cargo, rustc) | 1.99.1 | `~/.cargo`, `~/.rustup` (사용자 범위) | `shell/tauri`: 사이드카 관리 크레이트(`apps/desktop/src-tauri/crates/vater-sidecar`) 빌드·테스트 | 공식 `rustup-init`을 sha256 검증 후 `--no-modify-path`로 설치. PATH에 넣지 않았으므로 `~/.cargo/bin/cargo`로 직접 부른다 |
| 2026-11-03 | rustup 구성 요소 `rustfmt`, `clippy` | 1.99.1 | `~/.rustup` | `cargo fmt --check`, `cargo clippy -- -D warnings` | `rustup component add rustfmt clippy` (공식 배포) |
| 2026-11-03 | rustup 대상 `x86_64-pc-windows-msvc` (표준 라이브러리만) | 1.99.1 | `~/.rustup` | WSL에서 Windows 전용 코드(`CREATE_NO_WINDOW`)를 `cargo check`/`clippy --target`으로 타입 검사 | `rustup target add x86_64-pc-windows-msvc`. 링크(MSVC 링커)는 하지 않으므로 실행 파일은 만들지 못함 |
| 2026-11-03 | fonttools + brotli (`uvx`로 실행) | fonttools 4.68.0 | uv 캐시 (설치하지 않음) | Hahmlet 글꼴 서브셋, woff2 변환 (`pyftsubset`, `varLib.instancer`) | `ui/design-system`. 명령은 `apps/desktop/src/design-system/fonts/make-fonts.sh` |
| 2026-11-03 | 프런트엔드 npm 의존성 | `apps/desktop/package.json`에 정확한 버전 고정 | `apps/desktop/node_modules` (git 제외) | Vite, React 18, TypeScript, Vitest, ESLint, Prettier | `npm install --before=2026-10-20`으로 2주 이상 지난 버전만 받음. `package-lock.json` 커밋 |
| 2026-11-03 | Tauri CLI `@tauri-apps/cli` | 2.12.3 (2026-10-14 배포) | npm 캐시 (`npx`로 실행, `package.json`에 넣지 않음) | `shell/tauri`: `tauri dev`, `tauri build --bundles nsis`, `tauri icon` | 2.12.4는 2026-10-21 배포라 2주 기준에 못 미쳐 쓰지 않음. 명령은 `apps/desktop/src-tauri/README.md` |
| 2026-11-03 | Tauri 2 Rust 크레이트 | tauri 2.12.4, tauri-build 2.7.3, single-instance 2.5.4, autostart 2.7.0, notification 2.7.0 | `apps/desktop/src-tauri/Cargo.toml`(`=` 고정), `Cargo.lock` 커밋 | Vater 셸 | 간접 의존성 471개도 2026-10-20 이전 배포 버전으로 맞춤 |
| 2026-11-03 | PyInstaller | 6.22.3 (2026-09-12 배포) | CI에서만, `uv run --with`로 잠깐 얹음 (설치·잠금 파일 변경 없음) | 사이드카 onedir `vater-core.exe` | `apps/desktop/src-tauri/packaging/build-sidecar.ps1`. `sidecar/pyproject.toml`과 `uv.lock`은 그대로 |
| 2026-11-03 | GitHub Action `Swatinem/rust-cache` | v2 | `.github/workflows/desktop.yml` | Windows 러너의 Cargo 빌드 캐시 | 서드파티 액션. 그 밖에 `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`, `astral-sh/setup-uv@v6` |
| 2026-11-03 | Rust (CI) | 1.99.1 (+ clippy) | Windows 러너 (`rustup toolchain install`) | `desktop.yml`의 clippy·test·Tauri 빌드 | 로컬과 같은 버전으로 고정 |

## 원래 설치되어 있던 것
| 도구 | 버전 | 용도 |
|---|---|---|
| superpowers | 6.4.2 | 브레인스토밍, 계획, TDD, 서브에이전트 개발, 코드 리뷰 |
| ui-ux-pro-max | 2.15.0 | 디자인 시스템, 토큰, 차트 |
| frontend-design | 1.1.1 | 프런트엔드 디자인 보조 |
| diagram-design | 2.6.110 | 구조도 |

## 설치 예정 (필요한 시점에)
| 도구 | 시점 | 용도 |
|---|---|---|
| KIS Code Assistant MCP | `core/kis` | 한투 API 문서·예제 검색 |
| Context7 MCP | 구현 시작 | 최신 라이브러리 문서 |
| Playwright MCP | `ui/*` | UI 확인, E2E 테스트 |
