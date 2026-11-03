//! 시작할 때 정하는 것: 사이드카 실행 방식, 자동 실행으로 켜졌는지.

use std::path::{Path, PathBuf};

use vater_sidecar::launch::Mode;

/// 자동 실행(부팅 시)으로 켜질 때 넘기는 인자. 이때는 창을 띄우지 않고 트레이에서 시작한다.
pub const AUTOSTART_ARG: &str = "--autostart";

/// 디버그 빌드(`tauri dev`)는 저장소의 사이드카를 `uv run`으로, 릴리스 빌드는 함께 들어 있는 `vater-core.exe`를 쓴다.
pub fn sidecar_mode() -> Mode {
    if cfg!(debug_assertions) {
        Mode::Dev
    } else {
        Mode::Bundled
    }
}

/// 개발 모드에서 쓰는 저장소의 `sidecar/` 폴더(컴파일한 위치 기준).
pub fn repo_sidecar_dir() -> PathBuf {
    // apps/desktop/src-tauri → 저장소 루트의 sidecar/
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../sidecar")
}

/// 실행 인자에 자동 실행 표시가 있는지.
pub fn started_by_autostart<I: IntoIterator<Item = String>>(args: I) -> bool {
    args.into_iter().any(|arg| arg == AUTOSTART_ARG)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repo_sidecar_dir_points_at_the_python_project() {
        let dir = repo_sidecar_dir();
        assert!(dir.join("pyproject.toml").is_file(), "{}", dir.display());
        assert!(dir.join("src/vater_core/__main__.py").is_file());
    }

    #[test]
    fn autostart_arg_is_detected() {
        let args = ["Vater.exe", "--autostart"].map(String::from);
        assert!(started_by_autostart(args));
        assert!(!started_by_autostart(["Vater.exe"].map(String::from)));
        assert!(!started_by_autostart(Vec::<String>::new()));
    }
}
