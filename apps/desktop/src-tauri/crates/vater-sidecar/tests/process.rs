//! SidecarManager를 실제 프로세스로 확인한다(Tauri 없이).
//!
//! 가짜 사이드카 `tests/fixtures/fake_sidecar.py`(표준 라이브러리만)를 Python으로 띄운다.
//! Python 실행 파일은 `VATER_TEST_PYTHON`으로 바꿀 수 있다(기본: Windows `python`, 그 밖 `python3`).
//! 시간 제한·재시작 백오프는 짧게 줄여서 쓴다. 운영 값은 `ManagerConfig::default()`.
//!
//! 실제 사이드카 테스트는 `#[ignore]`: `cargo test -- --ignored` (uv와 저장소의 `sidecar/` 필요).

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, Instant};

use tokio::runtime::Handle;
use vater_sidecar::events::SidecarEvent;
use vater_sidecar::launch::{self, Mode};
use vater_sidecar::process::{
    ManagerConfig, RequestError, SidecarInfo, SidecarManager, SidecarState, StopOutcome,
};
use vater_sidecar::restart::RestartPolicy;

// ---------- 도우미 ----------

fn python() -> String {
    std::env::var("VATER_TEST_PYTHON")
        .unwrap_or_else(|_| if cfg!(windows) { "python" } else { "python3" }.to_owned())
}

fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake_sidecar.py")
}

/// 테스트마다 따로 쓰는 임시 폴더. 끝나면 지운다.
struct Scratch(PathBuf);

impl Scratch {
    fn new(name: &str) -> Self {
        // Windows 파일 이름에 쓸 수 없는 문자(`:` 등)가 들어가지 않게 숫자만 쓴다
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "vater-sidecar-test-{}-{}-{}",
            name,
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }

    fn join(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// 가짜 사이드카 실행 명령. `runs`가 있으면 실행마다 PID가 그 파일에 한 줄씩 쌓인다.
fn fake(mode: &'static str, runs: Option<PathBuf>) -> impl Fn(&str) -> Command + Send + 'static {
    move |token: &str| {
        let mut cmd = Command::new(python());
        cmd.arg(fixture()).arg(mode).env("VATER_TOKEN", token);
        if let Some(runs) = &runs {
            cmd.env("FAKE_RUNS", runs);
        }
        cmd
    }
}

fn pids(runs: &Path) -> Vec<u32> {
    std::fs::read_to_string(runs)
        .unwrap_or_default()
        .lines()
        .filter_map(|l| l.trim().parse().ok())
        .collect()
}

/// 짧은 시간 제한: ready 5초(Windows 러너에서 Python 첫 실행이 느릴 수 있다), 종료 유예 0.5초,
/// 1분에 3회, 백오프 10·20·40ms. 시간 초과를 보는 테스트는 ready 제한을 따로 짧게 둔다.
fn fast_config() -> ManagerConfig {
    ManagerConfig {
        ready_timeout: Duration::from_secs(5),
        shutdown_grace: Duration::from_millis(500),
        policy: RestartPolicy::new(Duration::from_secs(60), 3)
            .with_backoff(Duration::from_millis(10), Duration::from_millis(40)),
    }
}

fn ignore_events(_: SidecarEvent) {}

async fn wait_until(
    manager: &SidecarManager,
    within: Duration,
    what: &str,
    pred: impl FnMut(&SidecarInfo) -> bool,
) -> SidecarInfo {
    let mut rx = manager.subscribe();
    match tokio::time::timeout(within, rx.wait_for(pred)).await {
        Ok(Ok(info)) => info.clone(),
        _ => panic!(
            "timed out waiting for {what}; last info: {:?}",
            manager.info()
        ),
    }
}

async fn wait_state(
    manager: &SidecarManager,
    state: SidecarState,
    within: Duration,
) -> SidecarInfo {
    wait_until(manager, within, &format!("{state:?}"), |i| i.state == state).await
}

fn http() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().build().unwrap()
}

async fn health_status(port: u16, token: &str) -> u16 {
    http()
        .get(format!("http://127.0.0.1:{port}/health"))
        .bearer_auth(token)
        .send()
        .await
        .unwrap()
        .status()
        .as_u16()
}

/// 프로세스가 끝났는지(좀비 포함 아님). Linux에서만 확인하고 다른 OS에서는 건너뛴다.
#[cfg(target_os = "linux")]
fn is_running(pid: u32) -> bool {
    match std::fs::read_to_string(format!("/proc/{pid}/stat")) {
        // 형식: "pid (comm) S ..." — comm에 공백이 있을 수 있어 마지막 ')' 뒤를 본다
        Ok(stat) => stat
            .rsplit_once(')')
            .map(|(_, rest)| !rest.trim_start().starts_with('Z'))
            .unwrap_or(false),
        Err(_) => false,
    }
}

#[cfg(not(target_os = "linux"))]
fn is_running(_pid: u32) -> bool {
    false
}

async fn assert_dead_soon(pid: u32) {
    let deadline = Instant::now() + Duration::from_secs(3);
    while is_running(pid) {
        assert!(Instant::now() < deadline, "process {pid} is still running");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

fn is_hex64(token: &str) -> bool {
    token.len() == 64 && token.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f'))
}

// ---------- 시작과 ready ----------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ready_line_makes_state_ready_with_port_and_token() {
    let manager = SidecarManager::start(
        &Handle::current(),
        fake("ready", None),
        ignore_events,
        fast_config(),
    );
    let info = wait_state(&manager, SidecarState::Ready, Duration::from_secs(10)).await;

    let port = info.port.expect("port when ready");
    let token = info.token.expect("token when ready");
    assert!(is_hex64(&token), "token must be 64 hex chars");
    // 사이드카가 받은 VATER_TOKEN과 info의 토큰이 같다: 그 토큰으로만 인증된다
    assert_eq!(health_status(port, &token).await, 200);
    assert_eq!(health_status(port, "wrong-token").await, 401);

    manager.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn state_is_starting_before_ready() {
    let config = ManagerConfig {
        ready_timeout: Duration::from_secs(30),
        ..fast_config()
    };
    let manager = SidecarManager::start(
        &Handle::current(),
        fake("silent", None),
        ignore_events,
        config,
    );
    let info = manager.info();
    assert_eq!(info.state, SidecarState::Starting);
    assert_eq!(info.port, None);
    assert_eq!(info.token, None);
    manager.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn notify_line_reaches_the_callback() {
    let (tx, rx) = mpsc::channel();
    let tx = Mutex::new(tx);
    let on_event = move |event: SidecarEvent| {
        let _ = tx.lock().unwrap().send(event);
    };
    let manager = SidecarManager::start(
        &Handle::current(),
        fake("notify", None),
        on_event,
        fast_config(),
    );

    let event = tokio::task::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(10)))
        .await
        .unwrap()
        .expect("notify event");
    assert_eq!(
        event,
        SidecarEvent::Notify {
            title: "삼성전자 RSI 30 이하".into(),
            body: "RSI가 28.4입니다.".into(),
            route: Some("/alerts".into()),
        }
    );
    manager.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn garbage_lines_are_skipped_and_ready_still_arrives() {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink = seen.clone();
    let manager = SidecarManager::start(
        &Handle::current(),
        fake("garbage", None),
        move |event| sink.lock().unwrap().push(event),
        fast_config(),
    );
    let info = wait_state(&manager, SidecarState::Ready, Duration::from_secs(10)).await;
    assert!(info.port.is_some());
    // JSON 아님·깨진 UTF-8·모르는 type·빈 줄은 콜백으로 가지 않는다
    assert!(seen.lock().unwrap().is_empty());
    manager.shutdown().await;
}

// ---------- 재시작 ----------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn dies_immediately_four_times_then_failed() {
    let scratch = Scratch::new("crash");
    let runs = scratch.join("runs");
    let manager = SidecarManager::start(
        &Handle::current(),
        fake("crash", Some(runs.clone())),
        ignore_events,
        fast_config(),
    );
    let info = wait_state(&manager, SidecarState::Failed, Duration::from_secs(15)).await;
    assert_eq!(info.port, None);
    assert_eq!(info.token, None);
    // 처음 실행 1회 + 재시작 3회 = 4회, 그 뒤로는 실행하지 않는다
    assert_eq!(pids(&runs).len(), 4);
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(pids(&runs).len(), 4);
    assert_eq!(manager.shutdown().await, StopOutcome::NotRunning);
    assert_eq!(manager.info().state, SidecarState::Failed);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn crash_before_ready_is_restarted_and_becomes_ready() {
    let scratch = Scratch::new("crash-once");
    let runs = scratch.join("runs");
    let manager = SidecarManager::start(
        &Handle::current(),
        fake("crash-once", Some(runs.clone())),
        ignore_events,
        fast_config(),
    );
    wait_state(&manager, SidecarState::Ready, Duration::from_secs(10)).await;
    assert_eq!(pids(&runs).len(), 2);
    manager.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn crash_after_ready_restarts_with_a_new_token() {
    let scratch = Scratch::new("ready-then-crash");
    let runs = scratch.join("runs");
    let manager = SidecarManager::start(
        &Handle::current(),
        fake("ready-then-crash", Some(runs.clone())),
        ignore_events,
        fast_config(),
    );
    let first = wait_state(&manager, SidecarState::Ready, Duration::from_secs(10)).await;
    let first_token = first.token.clone().unwrap();
    let second = wait_until(&manager, Duration::from_secs(10), "second ready", |i| {
        i.state == SidecarState::Ready && i.token.as_deref() != Some(first_token.as_str())
    })
    .await;
    let (port, token) = (second.port.unwrap(), second.token.unwrap());
    assert!(is_hex64(&token));
    assert_eq!(health_status(port, &token).await, 200);
    assert_eq!(pids(&runs).len(), 2);
    assert_eq!(manager.shutdown().await, StopOutcome::Exited(Some(0)));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn no_ready_within_timeout_is_killed_and_restarted_until_failed() {
    let scratch = Scratch::new("silent");
    let runs = scratch.join("runs");
    let config = ManagerConfig {
        ready_timeout: Duration::from_millis(400),
        ..fast_config()
    };
    let started = Instant::now();
    let manager = SidecarManager::start(
        &Handle::current(),
        fake("silent", Some(runs.clone())),
        ignore_events,
        config,
    );
    wait_state(&manager, SidecarState::Failed, Duration::from_secs(15)).await;
    // 4번 모두 시간 제한까지 기다렸다
    assert!(started.elapsed() >= Duration::from_millis(4 * 400));
    let pids = pids(&runs);
    assert_eq!(pids.len(), 4);
    for pid in pids {
        assert_dead_soon(pid).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn spawn_failure_counts_as_a_crash() {
    let missing = |_: &str| Command::new("/nonexistent/vater-core/vater-core.exe");
    let manager = SidecarManager::start(&Handle::current(), missing, ignore_events, fast_config());
    wait_state(&manager, SidecarState::Failed, Duration::from_secs(10)).await;
}

// ---------- 종료 ----------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn shutdown_request_lets_the_sidecar_exit_cleanly() {
    let config = ManagerConfig {
        shutdown_grace: Duration::from_secs(5),
        ..fast_config()
    };
    let manager = SidecarManager::start(
        &Handle::current(),
        fake("ready", None),
        ignore_events,
        config,
    );
    wait_state(&manager, SidecarState::Ready, Duration::from_secs(10)).await;

    let started = Instant::now();
    assert_eq!(manager.shutdown().await, StopOutcome::Exited(Some(0)));
    assert!(
        started.elapsed() < Duration::from_secs(4),
        "should not wait for the grace period"
    );
    let info = manager.info();
    assert_eq!(info.state, SidecarState::Stopped);
    assert_eq!(info.port, None);
    assert_eq!(info.token, None);
    // 두 번째 호출도 같은 결과를 바로 돌려준다
    assert_eq!(manager.shutdown().await, StopOutcome::Exited(Some(0)));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sidecar_ignoring_shutdown_is_killed_after_the_grace_period() {
    let scratch = Scratch::new("ignore-shutdown");
    let runs = scratch.join("runs");
    let manager = SidecarManager::start(
        &Handle::current(),
        fake("ignore-shutdown", Some(runs.clone())),
        ignore_events,
        fast_config(),
    );
    wait_state(&manager, SidecarState::Ready, Duration::from_secs(10)).await;

    let started = Instant::now();
    assert_eq!(manager.shutdown().await, StopOutcome::Killed);
    let took = started.elapsed();
    assert!(
        took >= Duration::from_millis(500),
        "killed before the grace period: {took:?}"
    );
    assert!(
        took < Duration::from_secs(3),
        "shutdown took too long: {took:?}"
    );
    assert_eq!(manager.info().state, SidecarState::Stopped);
    assert_dead_soon(pids(&runs)[0]).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn shutdown_before_ready_kills_at_once() {
    let scratch = Scratch::new("shutdown-starting");
    let runs = scratch.join("runs");
    let config = ManagerConfig {
        ready_timeout: Duration::from_secs(30),
        shutdown_grace: Duration::from_secs(5),
        ..fast_config()
    };
    let manager = SidecarManager::start(
        &Handle::current(),
        fake("silent", Some(runs.clone())),
        ignore_events,
        config,
    );
    // 프로세스가 뜰 때까지(PID가 기록될 때까지) 기다린다
    let deadline = Instant::now() + Duration::from_secs(10);
    while pids(&runs).is_empty() {
        assert!(Instant::now() < deadline, "fake sidecar never started");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let started = Instant::now();
    assert_eq!(manager.shutdown().await, StopOutcome::Killed);
    assert!(started.elapsed() < Duration::from_secs(2));
    assert_eq!(manager.info().state, SidecarState::Stopped);
    assert_dead_soon(pids(&runs)[0]).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn dropping_the_manager_kills_the_sidecar() {
    let scratch = Scratch::new("drop");
    let runs = scratch.join("runs");
    let manager = SidecarManager::start(
        &Handle::current(),
        fake("ready", Some(runs.clone())),
        ignore_events,
        fast_config(),
    );
    wait_state(&manager, SidecarState::Ready, Duration::from_secs(10)).await;
    let pid = pids(&runs)[0];
    assert!(cfg!(not(target_os = "linux")) || is_running(pid));
    drop(manager);
    assert_dead_soon(pid).await;
}

// ---------- 실제 사이드카 ----------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "실제 사이드카(uv run python -m vater_core)를 띄운다: cargo test -- --ignored"]
async fn real_sidecar_ready_health_and_clean_shutdown() {
    let repo_sidecar = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../../../sidecar")
        .canonicalize()
        .expect("repository sidecar/ folder");
    let scratch = Scratch::new("real");
    let env_file = scratch.join("empty.env");
    std::fs::write(&env_file, "").unwrap();
    let data_dir = scratch.join("data");

    // 운영과 같은 개발 명령에, 테스트용으로 데이터 폴더·비밀키 파일·백그라운드 작업만 바꾼다.
    let spawn = move |token: &str| {
        let mut cmd = launch::command(Mode::Dev, Path::new(""), &repo_sidecar, token);
        cmd.env("VATER_DATA_DIR", &data_dir)
            .env("VATER_BACKGROUND_JOBS", "0")
            .env("VATER_SECRET_BACKEND", "envfile")
            .env("VATER_ENV_FILE", &env_file);
        cmd
    };
    let config = ManagerConfig {
        // 처음 실행이면 uv가 가상환경을 만드느라 오래 걸릴 수 있다
        ready_timeout: Duration::from_secs(180),
        shutdown_grace: Duration::from_secs(5),
        // 실패하면 재시작하지 않고 바로 Failed
        policy: RestartPolicy::new(Duration::from_secs(600), 0),
    };
    let started = Instant::now();
    let manager = SidecarManager::start(&Handle::current(), spawn, ignore_events, config);
    let info = wait_state(&manager, SidecarState::Ready, Duration::from_secs(200)).await;
    let port = info.port.unwrap();
    let token = info.token.unwrap();
    println!("ready on 127.0.0.1:{port} after {:?}", started.elapsed());

    let response = http()
        .get(format!("http://127.0.0.1:{port}/health"))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    let status = response.status().as_u16();
    let body = response.text().await.unwrap();
    println!("GET /health -> {status} {body}");
    assert_eq!(status, 200);
    assert!(body.contains("\"ok\""));

    let stopping = Instant::now();
    let outcome = manager.shutdown().await;
    println!("shutdown -> {outcome:?} after {:?}", stopping.elapsed());
    assert_eq!(outcome, StopOutcome::Exited(Some(0)));
    assert_eq!(manager.info().state, SidecarState::Stopped);
}

// ---------- 사이드카 요청 (트레이의 감시 일시 중지·재개) ----------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn post_json_calls_the_ready_sidecar_with_its_token() {
    let manager = SidecarManager::start(
        &Handle::current(),
        fake("ready", None),
        ignore_events,
        fast_config(),
    );
    wait_state(&manager, SidecarState::Ready, Duration::from_secs(10)).await;
    assert_eq!(
        manager.post_json("/alerts/pause").await,
        Ok(serde_json::json!({"state": "paused"}))
    );
    assert_eq!(
        manager.post_json("/alerts/resume").await,
        Ok(serde_json::json!({"state": "running"}))
    );
    manager.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn post_json_before_ready_is_not_ready() {
    let config = ManagerConfig {
        ready_timeout: Duration::from_secs(30),
        ..fast_config()
    };
    let manager = SidecarManager::start(
        &Handle::current(),
        fake("silent", None),
        ignore_events,
        config,
    );
    assert_eq!(
        manager.post_json("/alerts/pause").await,
        Err(RequestError::NotReady)
    );
    manager.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn post_json_reports_a_non_success_status() {
    let manager = SidecarManager::start(
        &Handle::current(),
        fake("ready", None),
        ignore_events,
        fast_config(),
    );
    wait_state(&manager, SidecarState::Ready, Duration::from_secs(10)).await;
    assert_eq!(
        manager.post_json("/no-such-route").await,
        Err(RequestError::Status(404))
    );
    manager.shutdown().await;
}
