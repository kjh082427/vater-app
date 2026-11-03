//! Windows 알림: 사이드카 `notify` 이벤트와 창을 처음 숨길 때의 안내.

use std::collections::HashMap;
use std::path::Path;

use serde_json::Value;

/// 알림에 붙여 두는 화면 경로의 키(`extra`). 알림을 누르면 이 값으로 `navigate`를 보낸다.
pub const ROUTE_KEY: &str = "route";

/// 창을 처음 트레이로 숨길 때 한 번 보여 주는 안내 (스펙 2-1).
pub const TRAY_NOTICE_TITLE: &str = "Vater";
pub const TRAY_NOTICE_BODY: &str = "Vater는 트레이에서 계속 실행됩니다";

/// 안내를 이미 보였는지 기억하는 파일 이름(앱 설정 폴더 안).
const TRAY_NOTICE_MARKER: &str = "tray-notice-shown";

/// 알림의 `extra`에서 화면 경로를 꺼낸다. 없거나 문자열이 아니면 `None`.
pub fn route_from_extra(extra: &HashMap<String, Value>) -> Option<String> {
    extra.get(ROUTE_KEY)?.as_str().map(str::to_owned)
}

/// 트레이 안내를 지금 보여야 하면 `true`(처음 한 번). 보였다는 표시를 `config_dir`에 남긴다.
/// 표시를 남기지 못해도(쓰기 실패) 이번에는 보여 준다.
pub fn take_tray_notice(config_dir: &Path) -> bool {
    let marker = config_dir.join(TRAY_NOTICE_MARKER);
    if marker.exists() {
        return false;
    }
    let _ = std::fs::create_dir_all(config_dir).and_then(|()| std::fs::write(&marker, b""));
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        // Windows 파일 이름에 쓸 수 없는 문자(`:` 등)가 들어가지 않게 숫자만 쓴다
        let dir =
            std::env::temp_dir().join(format!("vater-notify-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn route_is_read_from_extra() {
        let extra = HashMap::from([(ROUTE_KEY.to_owned(), json!("/alerts/events"))]);
        assert_eq!(route_from_extra(&extra), Some("/alerts/events".into()));
    }

    #[test]
    fn missing_or_non_string_route_is_none() {
        assert_eq!(route_from_extra(&HashMap::new()), None);
        let extra = HashMap::from([(ROUTE_KEY.to_owned(), json!(null))]);
        assert_eq!(route_from_extra(&extra), None);
        let extra = HashMap::from([(ROUTE_KEY.to_owned(), json!(3))]);
        assert_eq!(route_from_extra(&extra), None);
    }

    #[test]
    fn tray_notice_is_shown_once_and_remembered() {
        // 설정 폴더가 아직 없어도 만든다
        let dir = temp_dir("once").join("nested");
        assert!(take_tray_notice(&dir));
        assert!(!take_tray_notice(&dir));
        assert!(!take_tray_notice(&dir));
        assert!(dir.join(TRAY_NOTICE_MARKER).exists());
        std::fs::remove_dir_all(dir.parent().unwrap()).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn tray_notice_is_still_shown_when_the_marker_cannot_be_written() {
        // 일반 파일 아래에는 폴더를 만들 수 없다
        let blocker = temp_dir("blocked");
        std::fs::write(&blocker, b"").unwrap();
        let dir = blocker.join("config");
        assert!(take_tray_notice(&dir));
        std::fs::remove_file(&blocker).unwrap();
    }
}
