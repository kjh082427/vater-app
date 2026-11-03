//! Vater 데스크톱 셸 (Tauri 2): 창·트레이·단일 인스턴스·자동 실행·Windows 알림, 사이드카 관리.
//!
//! 판단이 들어가는 부분은 Tauri 없이 테스트하는 모듈(`commands`의 형식, `tray`, `notify`, `startup`)과
//! `vater-sidecar` 크레이트에 두고, 여기서는 Tauri에 연결만 한다.

pub mod commands;
pub mod notify;
pub mod startup;
pub mod tray;
pub mod updater;

use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicI32, Ordering};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent, Wry};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_notification::NotificationExt;
use vater_sidecar::events::SidecarEvent;
use vater_sidecar::launch;
use vater_sidecar::process::{ManagerConfig, SidecarManager, SidecarState};

use crate::commands::{NAVIGATE_EVENT, NavigatePayload, SIDECAR_STATE_EVENT, SidecarStateEvent};

const MAIN_WINDOW: &str = "main";
const TRAY_ID: &str = "main";

/// 앱 전체가 함께 쓰는 상태.
pub struct Shell {
    sidecar: SidecarManager,
    /// 트레이가 알고 있는 감시 일시 중지 여부. 새 사이드카는 감시 중으로 시작한다.
    alerts_paused: Mutex<bool>,
    toggle_item: MenuItem<Wry>,
    /// 공개 키가 있어 업데이터 플러그인을 켰는가.
    updater_enabled: bool,
}

pub fn run() {
    let app = tauri::Builder::default()
        // 두 번째 실행은 새로 뜨지 않고 기존 창을 앞으로 (가장 먼저 등록해야 한다)
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![startup::AUTOSTART_ARG]),
        ))
        .invoke_handler(tauri::generate_handler![
            commands::get_sidecar_info,
            commands::get_autostart,
            commands::set_autostart,
            commands::open_log_folder,
            commands::get_app_version,
            commands::check_update,
            commands::install_update,
        ])
        .on_window_event(|window, event| {
            // 창을 닫으면 트레이로 숨긴다. 처음 한 번은 안내 알림 (스펙 2-1)
            if let WindowEvent::CloseRequested { api, .. } = event
                && window.label() == MAIN_WINDOW
            {
                api.prevent_close();
                let _ = window.hide();
                let app = window.app_handle();
                if let Ok(dir) = app.path().app_config_dir()
                    && notify::take_tray_notice(&dir)
                {
                    let _ = app
                        .notification()
                        .builder()
                        .title(notify::TRAY_NOTICE_TITLE)
                        .body(notify::TRAY_NOTICE_BODY)
                        .show();
                }
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();
            listen_notification_clicks(&handle)?;
            let sidecar = start_sidecar(&handle)?;
            let toggle_item = build_tray(&handle)?;
            let updater_enabled = updater::register(&handle);
            app.manage(Shell {
                sidecar,
                alerts_paused: Mutex::new(false),
                toggle_item,
                updater_enabled,
            });
            forward_sidecar_state(handle.clone());
            updater::check_in_background(handle.clone(), updater_enabled);
            // 자동 실행(부팅 시)이면 트레이에서만 시작한다
            if !startup::started_by_autostart(std::env::args()) {
                show_main_window(&handle);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build the Tauri app");

    app.run(|app, event| {
        // 어떤 경로로 끝나든 사이드카를 정리한다(이미 끝났으면 바로 돌아온다)
        if let RunEvent::Exit = event
            && let Some(shell) = app.try_state::<Shell>()
        {
            tauri::async_runtime::block_on(shell.sidecar.shutdown());
        }
    });
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// 알림 클릭 → 창을 띄우고, 알림에 화면 경로가 있으면 UI에 `navigate`를 보낸다.
/// 핸들러는 첫 알림보다 먼저 등록해야 클릭이 보고된다.
fn listen_notification_clicks(app: &AppHandle) -> tauri::Result<()> {
    let handle = app.clone();
    app.notification()
        .on_action(move |performed| {
            if performed.action_id() != "tap" {
                return;
            }
            show_main_window(&handle);
            let route = performed
                .notification()
                .and_then(|n| notify::route_from_extra(n.extra()));
            if let Some(route) = route {
                let _ = handle.emit(NAVIGATE_EVENT, NavigatePayload { route });
            }
        })
        .map_err(|e| tauri::Error::Anyhow(e.into()))
}

fn start_sidecar(app: &AppHandle) -> tauri::Result<SidecarManager> {
    let mode = startup::sidecar_mode();
    let resource_dir = app.path().resource_dir()?;
    let repo_sidecar = startup::repo_sidecar_dir();
    let notify_handle = app.clone();
    let next_id = Arc::new(AtomicI32::new(1));
    Ok(SidecarManager::start(
        tauri::async_runtime::handle().inner(),
        move |token| launch::command(mode, &resource_dir, &repo_sidecar, token),
        move |event| {
            if let SidecarEvent::Notify { title, body, route } = event {
                let mut builder = notify_handle
                    .notification()
                    .builder()
                    .id(next_id.fetch_add(1, Ordering::Relaxed))
                    .title(title)
                    .body(body);
                if let Some(route) = route {
                    builder = builder.extra(notify::ROUTE_KEY, route);
                }
                let _ = builder.show();
            }
            // log 이벤트: 사이드카가 자기 로그 파일에 쓰므로 셸은 따로 남기지 않는다
        },
        ManagerConfig::default(),
    ))
}

/// 트레이 아이콘과 메뉴(열기 · 감시 일시 중지/재개 · 종료). 감시 메뉴 항목을 돌려준다.
fn build_tray(app: &AppHandle) -> tauri::Result<MenuItem<Wry>> {
    let open = MenuItem::with_id(app, tray::MENU_OPEN, "열기", true, None::<&str>)?;
    // 사이드카가 준비될 때까지는 누를 수 없다
    let toggle = MenuItem::with_id(
        app,
        tray::MENU_TOGGLE_ALERTS,
        tray::menu_label(false),
        false,
        None::<&str>,
    )?;
    let quit_item = MenuItem::with_id(app, tray::MENU_QUIT, "종료", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &toggle, &separator, &quit_item])?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Vater")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            tray::MENU_OPEN => show_main_window(app),
            tray::MENU_TOGGLE_ALERTS => toggle_alerts(app.clone()),
            tray::MENU_QUIT => quit(app.clone()),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(toggle)
}

/// 감시 일시 중지/재개: 사이드카에 요청하고, 응답의 상태로 메뉴 글자를 바꾼다.
fn toggle_alerts(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let shell = app.state::<Shell>();
        let paused = *lock(&shell.alerts_paused);
        let Ok(response) = shell.sidecar.post_json(tray::toggle_path(paused)).await else {
            return; // 준비 전이거나 응답이 없으면 그대로 둔다
        };
        if let Some(paused) = tray::paused_from_response(&response) {
            *lock(&shell.alerts_paused) = paused;
            let _ = shell.toggle_item.set_text(tray::menu_label(paused));
        }
    });
}

/// 트레이 "종료": 창을 숨기고 사이드카를 정상 종료(5초 넘으면 강제)한 뒤 앱을 끝낸다.
fn quit(app: AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.hide();
    }
    tauri::async_runtime::spawn(async move {
        app.state::<Shell>().sidecar.shutdown().await;
        app.exit(0);
    });
}

/// 사이드카 상태가 바뀔 때마다 UI에 `sidecar-state`를 보내고 트레이 메뉴를 맞춘다.
fn forward_sidecar_state(app: AppHandle) {
    let mut rx = app.state::<Shell>().sidecar.subscribe();
    tauri::async_runtime::spawn(async move {
        loop {
            let info = rx.borrow_and_update().clone();
            let shell = app.state::<Shell>();
            let ready = info.state == SidecarState::Ready;
            if ready {
                // 새로 뜬 사이드카는 감시 중으로 시작한다
                *lock(&shell.alerts_paused) = false;
                let _ = shell.toggle_item.set_text(tray::menu_label(false));
            }
            let _ = shell.toggle_item.set_enabled(ready);
            let _ = app.emit(SIDECAR_STATE_EVENT, SidecarStateEvent::from(&info));
            if rx.changed().await.is_err() {
                break;
            }
        }
    });
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
