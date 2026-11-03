//! UI가 부르는 Tauri 커맨드와 UI로 보내는 이벤트의 형식.
//!
//! 계약(ui/screens 브랜치가 쓴다, README에 같은 내용):
//! - `get_sidecar_info` → `{ state: "starting"|"ready"|"failed"|"stopped", port?: number, token?: string }`
//! - 이벤트 `sidecar-state`: 상태가 바뀔 때마다 `{ state, port? }`(토큰 없음). 받으면 `get_sidecar_info`를 다시 부른다
//!   (재시작하면 포트와 토큰이 바뀐다). UI는 이 이벤트를 **먼저 구독하고** 그다음 `get_sidecar_info`를 부른다.
//! - 이벤트 `navigate`: `{ route: string }`, 알림을 눌렀을 때.

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;
use vater_sidecar::process::{SidecarInfo, SidecarState};

use crate::Shell;

/// `sidecar-state` 이벤트 이름.
pub const SIDECAR_STATE_EVENT: &str = "sidecar-state";
/// `navigate` 이벤트 이름.
pub const NAVIGATE_EVENT: &str = "navigate";

/// UI에 넘기는 사이드카 상태. `port`와 `token`은 `ready`일 때만 들어 있다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SidecarInfoDto {
    pub state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
}

impl From<&SidecarInfo> for SidecarInfoDto {
    fn from(info: &SidecarInfo) -> Self {
        let state = match info.state {
            SidecarState::Starting => "starting",
            SidecarState::Ready => "ready",
            SidecarState::Failed => "failed",
            SidecarState::Stopped => "stopped",
        };
        Self {
            state,
            port: info.port,
            token: info.token.clone(),
        }
    }
}

/// `sidecar-state` 이벤트의 내용. 토큰은 싣지 않는다(토큰은 `get_sidecar_info`로만).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SidecarStateEvent {
    pub state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
}

impl From<&SidecarInfo> for SidecarStateEvent {
    fn from(info: &SidecarInfo) -> Self {
        let dto = SidecarInfoDto::from(info);
        Self {
            state: dto.state,
            port: dto.port,
        }
    }
}

/// `navigate` 이벤트의 내용.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NavigatePayload {
    pub route: String,
}

/// 사이드카의 상태·포트·토큰. UI는 `ready`일 때 받은 포트와 토큰으로 사이드카를 부른다.
#[tauri::command]
pub fn get_sidecar_info(shell: State<'_, Shell>) -> SidecarInfoDto {
    SidecarInfoDto::from(&shell.sidecar.info())
}

/// 부팅 시 자동 실행이 켜져 있는지(첫 실행 마법사·설정 화면).
#[tauri::command]
pub fn get_autostart(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

/// 부팅 시 자동 실행을 켜거나 끈다. 바뀐 뒤의 상태를 돌려준다.
#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let autolaunch = app.autolaunch();
    let result = if enabled {
        autolaunch.enable()
    } else {
        autolaunch.disable()
    };
    result.map_err(|e| e.to_string())?;
    autolaunch.is_enabled().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn info(state: SidecarState, port: Option<u16>, token: Option<&str>) -> SidecarInfo {
        SidecarInfo {
            state,
            port,
            token: token.map(str::to_owned),
        }
    }

    #[test]
    fn ready_info_has_port_and_token() {
        let dto = SidecarInfoDto::from(&info(SidecarState::Ready, Some(54321), Some("ab12")));
        assert_eq!(
            serde_json::to_value(dto).unwrap(),
            json!({"state": "ready", "port": 54321, "token": "ab12"})
        );
    }

    #[test]
    fn other_states_have_only_the_state() {
        for (state, name) in [
            (SidecarState::Starting, "starting"),
            (SidecarState::Failed, "failed"),
            (SidecarState::Stopped, "stopped"),
        ] {
            let dto = SidecarInfoDto::from(&info(state, None, None));
            assert_eq!(serde_json::to_value(dto).unwrap(), json!({ "state": name }));
        }
    }

    #[test]
    fn state_event_never_carries_the_token() {
        // 토큰은 get_sidecar_info로만 넘긴다. 이벤트는 상태(와 포트)만 알리고, UI가 다시 읽는다.
        let ev = SidecarStateEvent::from(&info(SidecarState::Ready, Some(54321), Some("ab12")));
        assert_eq!(
            serde_json::to_value(ev).unwrap(),
            json!({"state": "ready", "port": 54321})
        );
        let ev = SidecarStateEvent::from(&info(SidecarState::Starting, None, None));
        assert_eq!(
            serde_json::to_value(ev).unwrap(),
            json!({"state": "starting"})
        );
    }

    #[test]
    fn navigate_payload_shape() {
        let payload = NavigatePayload {
            route: "/alerts".into(),
        };
        assert_eq!(
            serde_json::to_value(payload).unwrap(),
            json!({"route": "/alerts"})
        );
    }
}
