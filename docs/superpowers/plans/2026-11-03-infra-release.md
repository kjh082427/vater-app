# infra/release 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 태그 하나(`v0.1.0`)로 서명된 설치 파일과 업데이트 파일을 공개 저장소 `kjh082427/vater-releases`에 올리고, 설치된 앱이 새 버전을 찾아 받아 적용하게 한다(스펙 0장 성공 기준 1·5).

**Architecture:**
- **릴리스 워크플로**(`release.yml`)가 `desktop.yml`과 같은 Windows 빌드에 서명과 업로드를 더한다. 서명 개인 키와 업로드 토큰은 Actions 비밀값에만 둔다.
- **앱 쪽 업데이터**는 셸의 `updater.rs`가 맡는다. 판단은 순수 함수(`decide`)로 떼어 내 `cargo test`로 확인하고, Tauri 플러그인 호출은 얇게 둔다. 공개 키(`pubkey`)가 설정에 없으면 플러그인을 켜지 않는다(업데이트 없이 정상 동작).
- 설정 화면 일반 구역에 버전과 [업데이트 확인]을 둔다. 화면은 `platform/` 어댑터 뒤에서 셸 커맨드를 부른다.

**Tech Stack:** `tauri-plugin-updater` `=2.14.0`(2026-10-14 배포), Tauri CLI `2.12.3`, GitHub Actions(windows-latest), PowerShell, 기존 `desktop.yml`·`acceptance-installed.ps1` 재사용. 새 npm 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-11-02-vater-mvp-design.md` 11장(빌드와 배포), 8장(앱 업데이트 실패 → 현재 버전 유지, 다음 실행 때 재시도, 표시하지 않음), 0장 성공 기준 1·5. 인수인계: `docs/HANDOFF.md` 4장.

## 영역 예외 (스펙 12-1)
- 이 브랜치는 `infra/release`이고 폴더는 `.github/workflows/release*`, `packaging/`다. **업데이터는 셸(`apps/desktop/src-tauri/src/updater.rs`, `Cargo.toml`, `tauri.conf.json`, `lib.rs`)과 설정 화면 한 곳(`src/screens/settings/`의 일반 구역, `src/platform/`)을 함께 건드린다.** 세 영역을 따로 PR로 내면 Windows 검사(약 25분)를 세 번 기다리므로 한 브랜치로 하되, PR 본문에 영역 예외로 적는다.

## Global Constraints
- 라벨 `area:infra`. **주문 API 없음.**
- **서명 개인 키·비밀번호·업로드 토큰은 코드·로그·커밋·채팅에 남기지 않는다.** 워크플로는 `secrets.*`로만 쓰고, 로그에 찍지 않는다. 공개 키만 `tauri.conf.json`에 둔다.
- 코드 서명(Authenticode)은 v1에서 하지 않는다. SmartScreen 안내를 README에 넣는다.
- 업데이트 주소: `https://github.com/kjh082427/vater-releases/releases/latest/download/latest.json`. `vater-releases`에는 설치 파일·`.sig`·`latest.json`만 올리고 **소스는 올리지 않는다.**
- 업데이트 실패(서버 없음, 서명 틀림, 다운로드 실패)는 **표시하지 않고** 현재 버전을 유지하며 다음 실행 때 다시 확인한다. 로그에는 오류 종류만 남긴다.
- 버전은 SemVer이고 **한 곳(`src-tauri/Cargo.toml`의 package version)이 기준**이다. `package.json`, `sidecar/pyproject.toml`, 태그가 같아야 한다(테스트가 검사). 설치 파일 이름은 `Vater_<버전>_x64-setup.exe`다.
- 새 의존성은 배포 2주 지난 버전으로 `=` 고정한다. 새 도구는 `docs/TOOLING.md`에 적는다.
- 테스트를 먼저 쓴다. 테스트 실행과 커밋은 따로 한다.

## Review Focus
1. **공개 키가 비어 있거나 틀린 설정** → 앱이 시작 단계에서 죽지 않는다(업데이터만 꺼짐). (Task 2)
2. **업데이트 응답이 이상함**(JSON이 아님, 서명 틀림, 더 낮은 버전, 같은 버전) → 설치하지 않고 현재 버전 유지. (Task 2, 6)
3. **업데이트 설치 중 사이드카가 실행 중** → 설치 전에 사이드카를 정상 종료하고 끝낸다(파일이 잠겨 설치가 실패하지 않게). (Task 2)
4. **릴리스 워크플로가 중간에 실패** → `vater-releases`에 반쯤 올라간 릴리스가 남지 않는다(초안으로 올리고 마지막에 공개). (Task 4)
5. **태그와 버전이 다름**(`v0.2.0` 태그인데 Cargo는 0.1.0) → 빌드 전에 실패한다. (Task 1)

---

### Task 1: 버전을 한 곳에서 맞추기
**Files:** Create `apps/desktop/src-tauri/packaging/check-versions.py` / Test `sidecar/tests/test_versions.py`
- 규칙: 기준은 `apps/desktop/src-tauri/Cargo.toml`의 `[package] version`. `check-versions.py [--tag vX.Y.Z] [--set X.Y.Z]`
  - 인자가 없으면 네 곳(Cargo.toml, `apps/desktop/package.json`, `sidecar/pyproject.toml`, `package-lock.json`의 루트 version)이 같은지 검사한다.
  - `--tag`는 태그에서 `v`를 뗀 값과 기준 버전이 같은지 검사한다(프리릴리스 `0.1.0-rc.1` 포함).
  - `--set`은 네 곳을 모두 바꾼다.
- [ ] 테스트(실패 확인): 지금 저장소는 `package.json`이 `0.0.0`이라 불일치 → 실패. `--tag v0.1.0`은 통과, `--tag v0.2.0`은 실패(종료 코드 1), `--set 0.1.0-rc.1` 뒤 검사 통과, SemVer가 아닌 값 거절
- [ ] 구현 → `--set 0.1.0`으로 현재 불일치를 맞춤 → 통과 → 커밋 `feat(release): 버전을 한 곳에서 맞추고 태그와 대조`

### Task 2: 셸 업데이터
**Files:** Modify `src-tauri/Cargo.toml`(`tauri-plugin-updater = "=2.14.0"`), `Cargo.lock`, `tauri.conf.json`(`plugins.updater`), `src/lib.rs`, `src/commands.rs` / Create `src/updater.rs` / Test 같은 파일 `#[cfg(test)]`

**Interfaces (Produces)**
- `enum UpdateDecision { Disabled, UpToDate, Available { version: String, notes: Option<String> } }`
- `fn decide(pubkey_configured: bool, current: &str, offered: Option<(&str, Option<&str>)>) -> UpdateDecision` — 공개 키가 없으면 `Disabled`, 제안이 없거나 현재 이상이면 `UpToDate`, SemVer로 더 높으면 `Available`. 파싱할 수 없으면 `UpToDate`
- 커맨드 `get_app_version() -> String`, `check_update() -> UpdateInfoDto {state: "disabled"|"up_to_date"|"available", version?, notes?}`, `install_update() -> Result<(), String>`
- 이벤트 `update-available {version, notes?}`
- 시작 뒤 한 번 조용히 확인한다. 있으면 이벤트를 보내고 Windows 알림 "새 버전 X이(가) 준비되었습니다"를 띄운다. 실패는 로그에 종류만 남기고 알리지 않는다.
- `install_update`: 사이드카에 정상 종료를 요청한 뒤(`shell.sidecar.shutdown()`, 5초 제한) 내려받아 설치한다. NSIS 업데이트가 앱을 끝내고 다시 띄운다.
- 공개 키가 비어 있으면 플러그인을 등록하지 않는다(`setup` 안에서 `app.handle().plugin(...)`).
- [ ] 테스트(실패 확인): `decide`의 모든 경우(키 없음, 같음, 낮음, 높음, 프리릴리스 순서 `0.1.0-rc.1 < 0.1.0`, 파싱 불가), DTO JSON 모양(토큰 같은 것 없음), 공개 키 설정 읽기(없음·빈 문자열·있음)
- [ ] 구현, `cargo fmt/clippy/test`, 커밋 `feat(shell): 앱 업데이트 확인과 설치`

### Task 3: 설정 화면의 업데이트
**Files:** Modify `apps/desktop/src/platform/index.ts`(+테스트), `src/screens/settings/`(일반 구역), `src/mocks/` / Test 같은 폴더
- `platform`: `getAppVersion()`, `checkUpdate()`, `installUpdate()`, `onUpdateAvailable(cb)`. 브라우저 구현은 버전을 `/health`에서 읽고 업데이트는 `disabled`로 답한다.
- 일반 구역: 버전 표시, [업데이트 확인](결과: 최신입니다 / 새 버전 X 있음 + [지금 설치] / 업데이트를 쓸 수 없는 빌드입니다), `update-available` 이벤트가 오면 앱 위쪽에 정보 배너 "새 버전 X이(가) 있습니다 · [설정에서 설치]". 설치 중에는 버튼을 막고 "설치하면 앱이 다시 시작됩니다"를 보인다.
- [ ] 테스트(실패 확인): 세 상태의 문구, 설치 누르면 `installUpdate` 호출, 이벤트로 배너, 브라우저에서는 `disabled` 안내
- [ ] 구현, `npm test`·lint·typecheck, 커밋 `feat(ui): 설정에 버전과 업데이트 확인`

### Task 4: 릴리스 워크플로
**Files:** Create `.github/workflows/release.yml`, `apps/desktop/src-tauri/packaging/make-latest-json.py` / Test `sidecar/tests/test_make_latest_json.py`
- `make-latest-json.py --version X --notes FILE --url URL --sig FILE` → `latest.json`(`version`, `notes`, `pub_date`(UTC ISO), `platforms.windows-x86_64.{signature,url}`)
- 워크플로 `release`
  - 트리거: `v*` 태그 push와 `workflow_dispatch`(입력 `version`)
  - 순서
    1. `check-versions.py --tag`
    2. `desktop.yml`과 같은 PyInstaller 빌드와 사이드카 스모크
    3. Tauri NSIS를 `--config '{"bundle":{"createUpdaterArtifacts":true}}'`와 서명 비밀값으로 빌드
    4. 설치 스모크
    5. `make-latest-json.py`
    6. `gh release create <태그> --repo kjh082427/vater-releases --draft`로 초안을 올림
    7. 올린 파일 목록과 `latest.json`을 검증
    8. 초안을 공개(`gh release edit --draft=false`). 프리릴리스 태그(`-rc`)는 `--prerelease`
  - 중간에 실패하면 초안이 남는다. 공개된 릴리스는 불완전하지 않다.
  - `permissions: contents: read`, 비밀값은 필요한 단계의 `env`에만 둔다. `RELEASES_TOKEN`은 6~8단계에서만 쓴다.
  - 비밀값이 없으면(포크, 설정 전) 서명·업로드를 건너뛰고 설치 파일만 만들며 이유를 로그에 적는다.
- [ ] 테스트(실패 확인): `latest.json` 모양(필드, 날짜 형식, URL 인코딩), 서명 파일 내용이 그대로 들어감, 버전·태그 불일치 거절
- [ ] 구현. 워크플로 문법은 `actionlint`가 없으므로 `workflow_dispatch`로 실제 실행해 확인한다(Task 6). 커밋 `ci(release): 태그로 서명된 설치 파일과 latest.json을 vater-releases에 올림`

### Task 5: CI 정리 (셸 리뷰 deferred #9)
**Files:** `.github/workflows/desktop.yml`, `ci.yml`
- 액션을 정확한 버전으로 고정, `setup-uv`의 uv 버전과 Python 3.13 패치 버전 고정, `cargo fmt --all --check` 단계 추가
- [ ] 커밋 `ci: 액션·uv·Python 버전을 고정하고 cargo fmt 검사를 더함`

### Task 6: 5단계 확인 테스트 R
**Files:** Create `.github/workflows/release-acceptance.yml`, `apps/desktop/src-tauri/packaging/acceptance-update.ps1`, `docs/superpowers/plans/2026-11-03-stage-5-acceptance.md`
- R3~R5는 **임시 서명 키 쌍을 CI 안에서 만들어**(`tauri signer generate`, 실제 키와 무관, 저장하지 않음) 확인한다.
  - 임시 공개 키와 테스트 주소(`http://127.0.0.1:8765/latest.json`, `dangerousInsecureTransportProtocol`)를 `--config`로 덧씌워 구버전(`0.1.0-rc.1`)과 신버전(`0.1.0-rc.2`)을 빌드한다.
  - 로컬 HTTP 서버가 `latest.json`과 신버전 설치 파일을 준다.
  - 구버전을 설치해 실행한다.
- R3: 앱이 새 버전을 찾아 받아 서명을 확인하고 적용, 다시 뜬 앱의 `/health` 버전이 신버전
- R4: 서명을 바꾼 `latest.json` → 설치하지 않고 구버전 유지
- R5: 서버를 끔 → 구버전 유지, 앱 정상, 서버를 켜고 다시 실행하면 업데이트됨
- R1·R2·R6(실제 릴리스 경로)은 실제 서명 키와 토큰이 비밀값에 있을 때 `v0.1.0-rc.1` 프리릴리스로 확인한다.
  - `vater-releases`에 파일이 올라가고 `latest.json`의 url·서명이 맞음
  - 올린 설치 파일을 받아 W1~W9 통과
  - 로그와 결과물에 키·토큰 없음, `vater-releases`에 소스 파일 없음
- R7: 사이드카·화면·셸 테스트와 `e2e`, `e2e:acceptance` 회귀
- [ ] 구현, 실제 실행, 결과를 계획서에 기록, 커밋 `test(release): 5단계 확인 테스트 R`

### Task 7: 문서
**Files:** `README.md`(루트), `docs/INSTALL.md`, `apps/desktop/src-tauri/README.md`(업데이터 절), `docs/TOOLING.md`, `docs/ARCHITECTURE.md`(PR 뒤)
- 설치 안내(다운로드 위치, SmartScreen "추가 정보 → 실행", 관리자 권한 불필요, WebView2 자동 설치), 첫 실행 마법사와 한투 키 발급, 자동 업데이트 동작, 제거 방법
- `vater-releases`의 README(소스 없음, 바이너리만, 설치 안내 링크)는 그 저장소에 직접 올린다.
- [ ] 커밋 `docs(release): 설치 안내와 릴리스 방법`
