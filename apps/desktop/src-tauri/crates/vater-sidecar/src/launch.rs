//! 사이드카 실행 명령과 일회용 토큰 (스펙 2-1, 11).
//!
//! - 운영(`Mode::Bundled`): Tauri `resources`에 들어 있는 PyInstaller onedir 폴더
//!   `vater-core/` 안의 `vater-core.exe`를 직접 실행한다.
//! - 개발(`Mode::Dev`): 저장소의 `sidecar/` 폴더에서 `uv run python -m vater_core`를 실행한다.
//!
//! 주의: `Command`의 `{:?}` 출력에는 환경변수(토큰)가 그대로 보인다. 로그에 쓰지 않는다.

use std::path::Path;
use std::process::{Command, Stdio};

/// 사이드카를 어떻게 실행할지.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// 설치된 앱: 함께 들어 있는 `vater-core.exe`.
    Bundled,
    /// 개발: `uv run python -m vater_core` (작업 폴더 `sidecar/`, `VATER_DEV=1`).
    Dev,
}

/// 사이드카 실행 명령을 만든다. 실행은 하지 않는다.
///
/// 공통: `VATER_TOKEN`을 넘기고, stdout은 파이프(이벤트 통로), stdin은 닫는다.
/// Windows에서는 콘솔 창이 뜨지 않게 한다. `VATER_DATA_DIR`는 넘기지 않는다.
pub fn command(mode: Mode, resource_dir: &Path, repo_sidecar: &Path, token: &str) -> Command {
    let mut cmd = match mode {
        Mode::Bundled => {
            let dir = resource_dir.join("vater-core");
            let mut cmd = Command::new(dir.join("vater-core.exe"));
            cmd.current_dir(dir);
            // 설치된 앱은 사용자 환경에 남은 VATER_DEV=1로 개발 모드(CORS 완화)가 되지 않게 한다.
            cmd.env_remove("VATER_DEV");
            cmd
        }
        Mode::Dev => {
            let mut cmd = Command::new("uv");
            cmd.args(["run", "python", "-m", "vater_core"])
                .current_dir(repo_sidecar)
                .env("VATER_DEV", "1");
            cmd
        }
    };
    cmd.env("VATER_TOKEN", token)
        .stdin(Stdio::null())
        .stdout(Stdio::piped());
    hide_console_window(&mut cmd);
    cmd
}

/// Windows: 콘솔 앱(`vater-core.exe`, `uv`)이 검은 콘솔 창을 띄우지 않게 한다.
#[cfg(windows)]
fn hide_console_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console_window(_cmd: &mut Command) {}

/// 일회용 토큰: 32바이트 난수의 16진수(64자).
///
/// `rand::fill`은 운영체제 난수로 시드한 암호학적 생성기(`ThreadRng`)를 쓴다.
pub fn new_token() -> String {
    let mut bytes = [0u8; 32];
    rand::fill(&mut bytes[..]);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;
    use std::path::PathBuf;

    const TOKEN: &str = "ab12";

    fn env_of<'a>(cmd: &'a Command, key: &str) -> Option<Option<&'a OsStr>> {
        cmd.get_envs()
            .find(|(k, _)| *k == OsStr::new(key))
            .map(|(_, v)| v)
    }

    fn args_of(cmd: &Command) -> Vec<&OsStr> {
        cmd.get_args().collect()
    }

    #[test]
    fn bundled_runs_vater_core_exe_from_the_resource_dir() {
        let resources = PathBuf::from("/opt/Vater/resources");
        let cmd = command(Mode::Bundled, &resources, Path::new("/repo/sidecar"), TOKEN);
        assert_eq!(
            cmd.get_program(),
            resources
                .join("vater-core")
                .join("vater-core.exe")
                .as_os_str()
        );
        assert!(args_of(&cmd).is_empty());
        assert_eq!(
            cmd.get_current_dir(),
            Some(resources.join("vater-core").as_path())
        );
    }

    #[test]
    fn dev_runs_uv_in_the_repo_sidecar_folder() {
        let repo_sidecar = PathBuf::from("/home/me/vater-app/sidecar");
        let cmd = command(Mode::Dev, Path::new("/unused"), &repo_sidecar, TOKEN);
        assert_eq!(cmd.get_program(), OsStr::new("uv"));
        assert_eq!(args_of(&cmd), ["run", "python", "-m", "vater_core"]);
        assert_eq!(cmd.get_current_dir(), Some(repo_sidecar.as_path()));
    }

    #[test]
    fn both_modes_pass_the_token() {
        for mode in [Mode::Bundled, Mode::Dev] {
            let cmd = command(mode, Path::new("/r"), Path::new("/s"), TOKEN);
            assert_eq!(env_of(&cmd, "VATER_TOKEN"), Some(Some(OsStr::new(TOKEN))));
        }
    }

    #[test]
    fn dev_sets_vater_dev() {
        let cmd = command(Mode::Dev, Path::new("/r"), Path::new("/s"), TOKEN);
        assert_eq!(env_of(&cmd, "VATER_DEV"), Some(Some(OsStr::new("1"))));
    }

    #[test]
    fn bundled_removes_an_inherited_vater_dev() {
        // 사용자 환경에 VATER_DEV=1이 남아 있어도 설치된 앱은 개발 모드(CORS 완화)로 뜨지 않는다
        let cmd = command(Mode::Bundled, Path::new("/r"), Path::new("/s"), TOKEN);
        assert_eq!(env_of(&cmd, "VATER_DEV"), Some(None));
    }

    #[test]
    fn data_dir_is_not_passed() {
        for mode in [Mode::Bundled, Mode::Dev] {
            let cmd = command(mode, Path::new("/r"), Path::new("/s"), TOKEN);
            assert_eq!(env_of(&cmd, "VATER_DATA_DIR"), None);
        }
    }

    /// 실제로 실행해 stdout이 파이프이고 stdin이 닫혀 있는지 본다.
    /// `vater-core.exe` 자리에 셸 스크립트를 두고 Bundled 명령을 그대로 실행한다.
    #[cfg(unix)]
    #[test]
    fn spawned_command_pipes_stdout_and_closes_stdin() {
        use std::io::Read;
        use std::os::unix::fs::PermissionsExt;

        let resources =
            std::env::temp_dir().join(format!("vater-launch-test-{}", std::process::id()));
        let dir = resources.join("vater-core");
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("vater-core.exe");
        // stdin이 닫혀 있으면 cat은 바로 끝난다. 토큰은 출력하지 않고 길이만 쓴다.
        std::fs::write(
            &exe,
            "#!/bin/sh\ncat\nprintf 'token-len=%s cwd=%s\\n' \"${#VATER_TOKEN}\" \"$(pwd)\"\n",
        )
        .unwrap();
        std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();

        let mut child = command(Mode::Bundled, &resources, Path::new("/s"), "0123456789")
            .spawn()
            .unwrap();
        assert!(child.stdin.is_none(), "stdin must not be a pipe");
        let mut out = String::new();
        child
            .stdout
            .take()
            .expect("stdout must be piped")
            .read_to_string(&mut out)
            .unwrap();
        assert!(child.wait().unwrap().success());
        let cwd = dir.canonicalize().unwrap();
        assert_eq!(out, format!("token-len=10 cwd={}\n", cwd.display()));
        std::fs::remove_dir_all(&resources).unwrap();
    }

    #[test]
    fn token_is_64_lowercase_hex_chars() {
        let token = new_token();
        assert_eq!(token.len(), 64);
        assert!(
            token.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')),
            "token has a non-hex char"
        );
    }

    #[test]
    fn tokens_differ_every_time() {
        let a = new_token();
        let b = new_token();
        assert_ne!(a, b);
    }
}
