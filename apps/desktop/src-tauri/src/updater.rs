//! 앱 자동 업데이트 (스펙 11장, 8장).
//!
//! `vater-releases`의 `latest.json`을 확인하고, 서명을 검증한 뒤 설치한다. 실패(서버 없음, 서명 틀림,
//! 다운로드 실패)는 화면에 알리지 않고 현재 버전을 유지하며 다음 실행 때 다시 확인한다(스펙 8장).
//!
//! 판단은 Tauri 없이 테스트하는 순수 함수에 둔다.

use std::time::Duration;

use semver::Version;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;

use crate::Shell;
use crate::notify::ROUTE_KEY;

/// 새 버전을 찾았을 때 UI로 보내는 이벤트: `{ state: "available", version, notes? }`.
pub const UPDATE_AVAILABLE_EVENT: &str = "update-available";
/// 알림을 누르면 가는 화면.
const SETTINGS_ROUTE: &str = "/settings";
/// 시작 직후의 일(사이드카 실행, 화면 로드)을 방해하지 않고, UI가 이벤트를 구독할 시간을 준다.
const BACKGROUND_CHECK_DELAY: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateDecision {
    /// 공개 키가 설정되지 않은 빌드: 업데이트를 쓰지 않는다.
    Disabled,
    UpToDate,
    Available {
        version: String,
        notes: Option<String>,
    },
}

/// `offered`는 서버가 제안한 `(버전, 설명)`. 더 높은 SemVer일 때만 `Available`이다.
/// 버전을 해석할 수 없으면 설치하지 않는 쪽을 고른다.
pub fn decide(
    pubkey_configured: bool,
    current: &str,
    offered: Option<(&str, Option<&str>)>,
) -> UpdateDecision {
    if !pubkey_configured {
        return UpdateDecision::Disabled;
    }
    let Some((version, notes)) = offered else {
        return UpdateDecision::UpToDate;
    };
    match (Version::parse(current), Version::parse(version)) {
        (Ok(now), Ok(next)) if next > now => UpdateDecision::Available {
            version: version.to_owned(),
            notes: notes.map(str::to_owned),
        },
        _ => UpdateDecision::UpToDate,
    }
}

/// `tauri.conf.json`의 `plugins.updater`에 공개 키가 있는가. 없으면 플러그인을 켜지 않는다.
pub fn pubkey_configured(plugin_config: Option<&Value>) -> bool {
    plugin_config
        .and_then(|c| c.get("pubkey"))
        .and_then(Value::as_str)
        .is_some_and(|k| !k.trim().is_empty())
}

/// `check_update`의 응답과 `update-available` 이벤트의 내용.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct UpdateInfoDto {
    pub state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

impl From<UpdateDecision> for UpdateInfoDto {
    fn from(decision: UpdateDecision) -> Self {
        let (state, version, notes) = match decision {
            UpdateDecision::Disabled => ("disabled", None, None),
            UpdateDecision::UpToDate => ("up_to_date", None, None),
            UpdateDecision::Available { version, notes } => ("available", Some(version), notes),
        };
        Self {
            state,
            version,
            notes,
        }
    }
}

pub fn notice_body(version: &str) -> String {
    format!("새 버전 {version}이(가) 있습니다. 눌러서 설정에서 설치하세요.")
}

/// 공개 키가 있으면 플러그인을 켠다. 설정이 잘못되어도 앱은 죽지 않고 업데이트만 꺼진다.
pub fn register(app: &AppHandle) -> bool {
    if !pubkey_configured(app.config().plugins.0.get("updater")) {
        return false;
    }
    match app.plugin(tauri_plugin_updater::Builder::new().build()) {
        Ok(()) => true,
        Err(e) => {
            eprintln!("updater disabled: {e}");
            false
        }
    }
}

/// 새 버전을 확인한다. 연결 실패 등은 `Err`(버튼을 눌렀을 때만 보여 준다).
pub async fn check(app: &AppHandle, enabled: bool) -> Result<UpdateDecision, String> {
    if !enabled {
        return Ok(UpdateDecision::Disabled);
    }
    let offered = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    let current = app.package_info().version.to_string();
    Ok(decide(
        true,
        &current,
        offered
            .as_ref()
            .map(|u| (u.version.as_str(), u.body.as_deref())),
    ))
}

/// 내려받아 서명을 확인한 뒤 사이드카를 끝내고 설치한다. Windows에서는 설치 프로그램이 앱을 끝내고 다시 띄운다.
/// 내려받기·서명 확인이 실패하면 아무것도 바꾸지 않는다. 설치 시작이 실패하면 앱을 다시 띄워
/// 이미 끝낸 사이드카를 되살린다.
pub async fn install(app: AppHandle) -> Result<(), String> {
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "새 버전이 없습니다.".to_string())?;
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    if let Some(shell) = app.try_state::<Shell>() {
        shell.sidecar.shutdown().await;
    }
    if let Err(e) = update.install(bytes) {
        eprintln!("update install failed: {e}");
        app.restart();
    }
    Ok(())
}

/// 시작 뒤 한 번 조용히 확인한다. 실패는 알리지 않는다(스펙 8장). 다음 실행 때 다시 확인한다.
pub fn check_in_background(app: AppHandle, enabled: bool) {
    if !enabled {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(BACKGROUND_CHECK_DELAY).await;
        match check(&app, true).await {
            Ok(decision @ UpdateDecision::Available { .. }) => {
                let info = UpdateInfoDto::from(decision);
                let version = info.version.clone().unwrap_or_default();
                let _ = app.emit(UPDATE_AVAILABLE_EVENT, info);
                let _ = app
                    .notification()
                    .builder()
                    .title("Vater")
                    .body(notice_body(&version))
                    .extra(ROUTE_KEY, SETTINGS_ROUTE)
                    .show();
                // 확인 테스트 전용 빌드: 사람 대신 바로 설치한다(5단계 확인 R3~R5)
                #[cfg(feature = "e2e-auto-update")]
                if let Err(e) = install(app.clone()).await {
                    eprintln!("update failed: {e}");
                }
            }
            Ok(_) => {}
            Err(e) => eprintln!("update check failed: {e}"),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn no_pubkey_means_disabled_whatever_is_offered() {
        assert_eq!(
            decide(false, "0.1.0", Some(("9.9.9", None))),
            UpdateDecision::Disabled
        );
        assert_eq!(decide(false, "0.1.0", None), UpdateDecision::Disabled);
    }

    #[test]
    fn nothing_offered_or_not_newer_is_up_to_date() {
        assert_eq!(decide(true, "0.1.0", None), UpdateDecision::UpToDate);
        assert_eq!(
            decide(true, "0.1.0", Some(("0.1.0", None))),
            UpdateDecision::UpToDate
        );
        assert_eq!(
            decide(true, "0.2.0", Some(("0.1.9", None))),
            UpdateDecision::UpToDate
        );
    }

    #[test]
    fn newer_version_is_available_with_notes() {
        assert_eq!(
            decide(true, "0.1.0", Some(("0.2.0", Some("고침")))),
            UpdateDecision::Available {
                version: "0.2.0".into(),
                notes: Some("고침".into())
            }
        );
    }

    #[test]
    fn prerelease_orders_before_its_release() {
        assert!(matches!(
            decide(true, "0.1.0-rc.1", Some(("0.1.0-rc.2", None))),
            UpdateDecision::Available { .. }
        ));
        assert!(matches!(
            decide(true, "0.1.0-rc.2", Some(("0.1.0", None))),
            UpdateDecision::Available { .. }
        ));
        assert_eq!(
            decide(true, "0.1.0", Some(("0.1.0-rc.2", None))),
            UpdateDecision::UpToDate
        );
    }

    #[test]
    fn unparsable_versions_never_offer_an_update() {
        assert_eq!(
            decide(true, "0.1.0", Some(("latest", None))),
            UpdateDecision::UpToDate
        );
        assert_eq!(
            decide(true, "dev", Some(("0.2.0", None))),
            UpdateDecision::UpToDate
        );
    }

    #[test]
    fn pubkey_is_configured_only_with_a_non_blank_string() {
        assert!(!pubkey_configured(None));
        assert!(!pubkey_configured(Some(&json!({}))));
        assert!(!pubkey_configured(Some(&json!({"pubkey": ""}))));
        assert!(!pubkey_configured(Some(&json!({"pubkey": "   "}))));
        assert!(!pubkey_configured(Some(&json!({"pubkey": 3}))));
        assert!(pubkey_configured(Some(&json!({"pubkey": "dW50cnVzdGVk"}))));
    }

    #[test]
    fn dto_json_shape() {
        assert_eq!(
            serde_json::to_value(UpdateInfoDto::from(UpdateDecision::Disabled)).unwrap(),
            json!({"state": "disabled"})
        );
        assert_eq!(
            serde_json::to_value(UpdateInfoDto::from(UpdateDecision::UpToDate)).unwrap(),
            json!({"state": "up_to_date"})
        );
        assert_eq!(
            serde_json::to_value(UpdateInfoDto::from(UpdateDecision::Available {
                version: "0.2.0".into(),
                notes: None
            }))
            .unwrap(),
            json!({"state": "available", "version": "0.2.0"})
        );
    }

    #[test]
    fn notice_names_the_version() {
        assert_eq!(
            notice_body("0.2.0"),
            "새 버전 0.2.0이(가) 있습니다. 눌러서 설정에서 설치하세요."
        );
    }
}
