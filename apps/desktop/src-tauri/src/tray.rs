//! 트레이 메뉴: 열기 · 감시 일시 중지/재개 · 종료 (스펙 9-1).

use serde_json::Value;

pub const MENU_OPEN: &str = "open";
pub const MENU_TOGGLE_ALERTS: &str = "toggle-alerts";
pub const MENU_QUIT: &str = "quit";

/// 감시 일시 중지/재개 메뉴의 글자. `paused`는 지금 감시가 멈춰 있는지.
pub fn menu_label(paused: bool) -> &'static str {
    if paused {
        "감시 재개"
    } else {
        "감시 일시 중지"
    }
}

/// 메뉴를 눌렀을 때 사이드카에 보낼 경로.
pub fn toggle_path(paused: bool) -> &'static str {
    if paused {
        "/alerts/resume"
    } else {
        "/alerts/pause"
    }
}

/// `POST /alerts/pause|resume` 응답(`{"state": "running"|"paused"|"offline"|"closed"}`)에서
/// 감시가 멈춰 있는지 읽는다. 형식이 다르면 `None`.
pub fn paused_from_response(response: &Value) -> Option<bool> {
    response
        .get("state")?
        .as_str()
        .map(|state| state == "paused")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn label_offers_pause_while_running_and_resume_while_paused() {
        assert_eq!(menu_label(false), "감시 일시 중지");
        assert_eq!(menu_label(true), "감시 재개");
    }

    #[test]
    fn toggle_calls_pause_while_running_and_resume_while_paused() {
        assert_eq!(toggle_path(false), "/alerts/pause");
        assert_eq!(toggle_path(true), "/alerts/resume");
    }

    #[test]
    fn paused_state_is_read_from_the_response() {
        assert_eq!(
            paused_from_response(&json!({"state": "paused"})),
            Some(true)
        );
        for state in ["running", "offline", "closed"] {
            assert_eq!(
                paused_from_response(&json!({ "state": state })),
                Some(false)
            );
        }
    }

    #[test]
    fn unexpected_response_is_none() {
        assert_eq!(paused_from_response(&json!({})), None);
        assert_eq!(paused_from_response(&json!({"state": 1})), None);
        assert_eq!(paused_from_response(&json!("paused")), None);
    }
}
