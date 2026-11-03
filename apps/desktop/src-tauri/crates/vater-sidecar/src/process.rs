//! 사이드카 관리자: 실행 → 감시 → 재시작 → 종료 (스펙 2-1).
//!
//! - 실행할 때마다 새 일회용 토큰을 만들어 `spawn_fn(token)`이 만든 명령으로 사이드카를 띄운다.
//! - stdout을 한 줄씩 읽는다. `ready`면 상태가 `Ready{port, token}`, `notify`·`log`는 `on_event`로 넘긴다.
//!   JSON이 아닌 줄, 모르는 type, 깨진 UTF-8, 너무 긴 줄은 건너뛰고 계속 읽는다.
//! - `ready`가 `ready_timeout`(60초) 안에 오지 않거나 요청하지 않은 종료가 나면 `RestartPolicy`를 따른다.
//!   10분 안에 3회를 넘으면 `Failed`에서 멈춘다.
//! - `shutdown()`은 `POST /shutdown` 뒤 `shutdown_grace`(5초) 안에 끝나지 않으면 강제 종료한다.
//!
//! 토큰은 메모리에만 둔다. `SidecarInfo`의 `{:?}` 출력은 토큰을 가린다.

use std::fmt;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::io::{AsyncBufRead, AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::runtime::Handle;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

use crate::events::{self, SidecarEvent};
use crate::job;
use crate::launch;
use crate::restart::{Decision, RestartPolicy};

/// stdout 한 줄의 최대 길이. 넘는 줄은 버린다(셸 메모리 보호).
pub const MAX_LINE_BYTES: usize = 1024 * 1024;

/// 시간 제한과 재시작 정책. `Default`는 운영 값(30초, 5초, 10분에 3회).
#[derive(Debug, Clone)]
pub struct ManagerConfig {
    /// 실행 뒤 `ready`를 기다리는 시간.
    pub ready_timeout: Duration,
    /// `POST /shutdown` 뒤 스스로 끝나기를 기다리는 시간. 지나면 강제 종료.
    pub shutdown_grace: Duration,
    pub policy: RestartPolicy,
}

impl Default for ManagerConfig {
    fn default() -> Self {
        Self {
            // 147MB onedir를 처음 실행하면 백신 검사로 수십 초가 걸릴 수 있다(느린 PC의 첫 실행)
            ready_timeout: Duration::from_secs(60),
            shutdown_grace: Duration::from_secs(5),
            policy: RestartPolicy::default(),
        }
    }
}

/// UI에 보이는 사이드카 상태.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SidecarState {
    /// 실행했고 `ready`를 기다리는 중(재시작 대기 포함).
    Starting,
    /// 요청을 받을 수 있다.
    Ready,
    /// 재시작을 멈췄다(10분 안에 3회 초과). UI는 오류 화면을 띄운다.
    Failed,
    /// `shutdown()`으로 끝났다.
    Stopped,
}

/// `get_sidecar_info`로 UI에 넘기는 값. `port`와 `token`은 `Ready`일 때만 있다.
#[derive(Clone, PartialEq, Eq)]
pub struct SidecarInfo {
    pub state: SidecarState,
    pub port: Option<u16>,
    pub token: Option<String>,
}

impl fmt::Debug for SidecarInfo {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SidecarInfo")
            .field("state", &self.state)
            .field("port", &self.port)
            .field("token", &self.token.as_ref().map(|_| "<redacted>"))
            .finish()
    }
}

/// `shutdown()`의 결과.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopOutcome {
    /// 종료 요청을 받고 스스로 끝났다. 종료 코드(시그널로 끝났으면 `None`).
    Exited(Option<i32>),
    /// 시간 안에 끝나지 않았거나 아직 `ready` 전이라 강제 종료했다.
    Killed,
    /// 실행 중인 사이드카가 없었다(재시작 대기 중, 이미 `Failed`, 이미 종료됨).
    NotRunning,
}

/// `post_json`이 실패한 이유. 토큰이나 주소는 담지 않는다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestError {
    /// 사이드카가 아직 `Ready`가 아니다(시작 중·실패·종료).
    NotReady,
    /// 사이드카가 2xx가 아닌 상태 코드로 답했다.
    Status(u16),
    /// 연결·시간 초과 등으로 응답을 받지 못했다.
    Transport,
    /// 응답 본문이 JSON이 아니다.
    InvalidJson,
}

impl fmt::Display for RequestError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotReady => write!(f, "사이드카가 아직 준비되지 않았습니다"),
            Self::Status(code) => write!(f, "사이드카가 상태 코드 {code}로 답했습니다"),
            Self::Transport => write!(f, "사이드카에 연결하지 못했습니다"),
            Self::InvalidJson => write!(f, "사이드카 응답이 JSON이 아닙니다"),
        }
    }
}

impl std::error::Error for RequestError {}

/// 사이드카에 보내는 요청의 시간 제한.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

type EventCallback = Arc<dyn Fn(SidecarEvent) + Send + Sync>;

impl SidecarInfo {
    fn without_endpoint(state: SidecarState) -> Self {
        Self {
            state,
            port: None,
            token: None,
        }
    }
}

/// 사이드카 하나를 실행·감시한다. 버리면(drop) 감시를 멈추고 프로세스를 강제 종료한다.
pub struct SidecarManager {
    info_rx: watch::Receiver<SidecarInfo>,
    stop_tx: watch::Sender<bool>,
    done_rx: watch::Receiver<Option<StopOutcome>>,
    task: JoinHandle<()>,
    http: reqwest::Client,
}

impl SidecarManager {
    /// `runtime`에서 감시 작업을 시작한다.
    ///
    /// `spawn_fn(token)`은 실행할 명령을 만든다(보통 `launch::command`). stdout은 관리자가 파이프로 바꾼다.
    /// `on_event`는 `notify`와 `log` 이벤트를 받는다(stdout을 읽는 작업에서 바로 불린다).
    pub fn start<S, E>(runtime: &Handle, spawn_fn: S, on_event: E, config: ManagerConfig) -> Self
    where
        S: Fn(&str) -> std::process::Command + Send + 'static,
        E: Fn(SidecarEvent) + Send + Sync + 'static,
    {
        let (info_tx, info_rx) =
            watch::channel(SidecarInfo::without_endpoint(SidecarState::Starting));
        let (stop_tx, stop_rx) = watch::channel(false);
        let (done_tx, done_rx) = watch::channel(None);
        // 127.0.0.1로만 보내므로 시스템·환경변수 프록시를 쓰지 않는다.
        let http = reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap_or_default();
        let supervisor = Supervisor {
            spawn_fn,
            on_event: Arc::new(on_event),
            config,
            info_tx,
            stop_rx,
            http: http.clone(),
        };
        let task = runtime.spawn(async move {
            let outcome = supervisor.supervise().await;
            done_tx.send_replace(Some(outcome));
        });
        Self {
            info_rx,
            stop_tx,
            done_rx,
            task,
            http,
        }
    }

    /// 지금 상태.
    pub fn info(&self) -> SidecarInfo {
        self.info_rx.borrow().clone()
    }

    /// 상태가 바뀔 때마다 알림을 받는다(UI에 상태를 밀어 줄 때).
    pub fn subscribe(&self) -> watch::Receiver<SidecarInfo> {
        self.info_rx.clone()
    }

    /// `Ready`인 사이드카에 `POST path`를 보내고(Bearer 토큰) JSON 응답을 돌려준다.
    /// 트레이의 감시 일시 중지·재개(`/alerts/pause`, `/alerts/resume`)에 쓴다.
    pub async fn post_json(&self, path: &str) -> Result<serde_json::Value, RequestError> {
        let SidecarInfo {
            state: SidecarState::Ready,
            port: Some(port),
            token: Some(token),
        } = self.info()
        else {
            return Err(RequestError::NotReady);
        };
        let response = self
            .http
            .post(format!("http://127.0.0.1:{port}{path}"))
            .bearer_auth(token)
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await
            .map_err(|_| RequestError::Transport)?;
        let status = response.status();
        if !status.is_success() {
            return Err(RequestError::Status(status.as_u16()));
        }
        let body = response
            .bytes()
            .await
            .map_err(|_| RequestError::Transport)?;
        serde_json::from_slice(&body).map_err(|_| RequestError::InvalidJson)
    }

    /// 정상 종료를 요청하고 끝날 때까지 기다린다. 여러 번 불러도 된다.
    /// 오래 걸려도 `shutdown_grace`와 강제 종료 시간만큼이다.
    pub async fn shutdown(&self) -> StopOutcome {
        self.stop_tx.send_replace(true);
        let mut done = self.done_rx.clone();
        match done.wait_for(Option::is_some).await {
            Ok(outcome) => outcome.unwrap_or(StopOutcome::NotRunning),
            // 감시 작업이 결과 없이 끝났다(패닉 등). 기다릴 것이 없다.
            Err(_) => StopOutcome::NotRunning,
        }
    }
}

impl Drop for SidecarManager {
    fn drop(&mut self) {
        // 감시 작업을 버리면 자식 프로세스도 버려지고 `kill_on_drop`으로 강제 종료된다.
        self.task.abort();
    }
}

/// 실행 1회가 끝난 이유.
enum RunEnd {
    /// 요청하지 않은 종료, 실행 실패, `ready` 시간 초과(강제 종료함).
    Exited,
    /// `shutdown()`으로 멈췄다.
    Stopped(StopOutcome),
}

struct Supervisor<S> {
    spawn_fn: S,
    on_event: EventCallback,
    config: ManagerConfig,
    info_tx: watch::Sender<SidecarInfo>,
    stop_rx: watch::Receiver<bool>,
    http: reqwest::Client,
}

impl<S> Supervisor<S>
where
    S: Fn(&str) -> std::process::Command,
{
    async fn supervise(mut self) -> StopOutcome {
        let mut policy = self.config.policy.clone();
        loop {
            if *self.stop_rx.borrow() {
                self.set(SidecarInfo::without_endpoint(SidecarState::Stopped));
                return StopOutcome::NotRunning;
            }
            // 실행할 때마다 새 일회용 토큰
            let token = launch::new_token();
            if let RunEnd::Stopped(outcome) = self.run_once(&token, &mut policy).await {
                self.set(SidecarInfo::without_endpoint(SidecarState::Stopped));
                return outcome;
            }
            // 끝난 사이드카의 포트·토큰은 더 쓸 수 없다
            self.set(SidecarInfo::without_endpoint(SidecarState::Starting));
            match policy.on_exit(Instant::now()) {
                Decision::GiveUp => {
                    self.set(SidecarInfo::without_endpoint(SidecarState::Failed));
                    return StopOutcome::NotRunning;
                }
                Decision::Restart { delay } => {
                    tokio::select! {
                        _ = tokio::time::sleep(delay) => {}
                        _ = stop_requested(&mut self.stop_rx) => {}
                    }
                }
            }
        }
    }

    async fn run_once(&mut self, token: &str, policy: &mut RestartPolicy) -> RunEnd {
        let mut cmd = Command::from((self.spawn_fn)(token));
        cmd.stdout(Stdio::piped()).kill_on_drop(true);
        let Ok(mut child) = cmd.spawn() else {
            return RunEnd::Exited;
        };
        // Windows: 셸이 비정상 종료돼도 사이드카가 남지 않게 셸의 작업 개체에 넣는다.
        // 넣지 못해도 사이드카는 그대로 쓴다(정상 종료 경로는 따로 정리한다).
        let _ = job::bind_to_shell(&child);
        let (ready_tx, mut ready_rx) = mpsc::unbounded_channel();
        if let Some(stdout) = child.stdout.take() {
            tokio::spawn(read_events(
                BufReader::new(stdout),
                ready_tx,
                self.on_event.clone(),
            ));
        }
        let ready_deadline = tokio::time::sleep(self.config.ready_timeout);
        tokio::pin!(ready_deadline);
        let mut port = None;
        loop {
            tokio::select! {
                Some(ready_port) = ready_rx.recv() => {
                    port = Some(ready_port);
                    policy.on_ready();
                    self.set(SidecarInfo {
                        state: SidecarState::Ready,
                        port: Some(ready_port),
                        token: Some(token.to_owned()),
                    });
                }
                _ = child.wait() => return RunEnd::Exited,
                _ = &mut ready_deadline, if port.is_none() => {
                    let _ = child.kill().await;
                    return RunEnd::Exited;
                }
                _ = stop_requested(&mut self.stop_rx) => {
                    let grace = self.config.shutdown_grace;
                    let outcome = stop_child(&self.http, &mut child, port, token, grace).await;
                    return RunEnd::Stopped(outcome);
                }
            }
        }
    }

    fn set(&self, info: SidecarInfo) {
        self.info_tx.send_replace(info);
    }
}

/// `shutdown()`이 불릴 때까지 기다린다. 관리자가 사라져도 멈춤 요청으로 본다.
async fn stop_requested(stop_rx: &mut watch::Receiver<bool>) {
    let _ = stop_rx.wait_for(|stop| *stop).await;
}

/// `POST /shutdown`을 보내고 `grace` 안에 끝나기를 기다린다. 지나면(또는 `ready` 전이면) 강제 종료.
async fn stop_child(
    http: &reqwest::Client,
    child: &mut Child,
    port: Option<u16>,
    token: &str,
    grace: Duration,
) -> StopOutcome {
    if let Some(port) = port {
        let request = http
            .post(format!("http://127.0.0.1:{port}/shutdown"))
            .bearer_auth(token)
            .timeout(grace)
            .send();
        let graceful = tokio::time::timeout(grace, async {
            // 202든 연결 오류든 결과와 상관없이 프로세스가 끝나기를 기다린다
            let _ = request.await;
            child.wait().await
        })
        .await;
        if let Ok(Ok(status)) = graceful {
            return StopOutcome::Exited(status.code());
        }
    }
    let _ = child.kill().await;
    StopOutcome::Killed
}

/// 한 줄을 읽는다(줄바꿈 제외). EOF면 `None`, 줄이 `max`를 넘으면 버리고 `Some(false)`.
/// 마지막 줄에 줄바꿈이 없어도 한 줄로 친다.
async fn read_line_capped<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    line: &mut Vec<u8>,
    max: usize,
) -> std::io::Result<Option<bool>> {
    line.clear();
    let mut read_any = false;
    let mut too_long = false;
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            return Ok(read_any.then_some(!too_long));
        }
        read_any = true;
        let newline = available.iter().position(|&b| b == b'\n');
        let end = newline.unwrap_or(available.len());
        if !too_long {
            if line.len() + end > max {
                too_long = true;
                line.clear();
            } else {
                line.extend_from_slice(&available[..end]);
            }
        }
        match newline {
            Some(i) => {
                reader.consume(i + 1);
                return Ok(Some(!too_long));
            }
            None => {
                let used = available.len();
                reader.consume(used);
            }
        }
    }
}

/// stdout을 끝까지 읽으며 이벤트를 나눈다. `ready`의 포트는 `ready_tx`로, 나머지는 `on_event`로.
/// 해석할 수 없는 줄과 모르는 type은 건너뛴다.
async fn read_events<R: AsyncBufRead + Unpin>(
    mut reader: R,
    ready_tx: mpsc::UnboundedSender<u16>,
    on_event: EventCallback,
) {
    let mut line = Vec::new();
    while let Ok(Some(fits)) = read_line_capped(&mut reader, &mut line, MAX_LINE_BYTES).await {
        if !fits {
            continue;
        }
        match events::parse_bytes(&line) {
            Some(SidecarEvent::Ready { port }) => {
                // 받는 쪽이 이미 끝났으면(이전 실행의 줄) 버린다
                let _ = ready_tx.send(port);
            }
            Some(SidecarEvent::Unknown) | None => {}
            Some(event) => on_event(event),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    async fn lines_of(input: &[u8], max: usize) -> Vec<Option<Vec<u8>>> {
        let mut reader = input;
        let mut line = Vec::new();
        let mut out = Vec::new();
        while let Some(fits) = read_line_capped(&mut reader, &mut line, max).await.unwrap() {
            out.push(fits.then(|| line.clone()));
        }
        out
    }

    #[tokio::test]
    async fn reads_lines_without_the_newline() {
        assert_eq!(
            lines_of(b"one\ntwo\n", 100).await,
            vec![Some(b"one".to_vec()), Some(b"two".to_vec())]
        );
    }

    #[tokio::test]
    async fn last_line_without_newline_still_counts() {
        assert_eq!(
            lines_of(b"one\ntwo", 100).await,
            vec![Some(b"one".to_vec()), Some(b"two".to_vec())]
        );
    }

    #[tokio::test]
    async fn empty_input_is_eof() {
        assert_eq!(lines_of(b"", 100).await, Vec::<Option<Vec<u8>>>::new());
    }

    #[tokio::test]
    async fn overlong_line_is_dropped_and_reading_continues() {
        let mut input = vec![b'x'; 50];
        input.extend_from_slice(b"\nok\n");
        assert_eq!(lines_of(&input, 10).await, vec![None, Some(b"ok".to_vec())]);
    }

    #[tokio::test]
    async fn line_exactly_at_the_limit_is_kept() {
        assert_eq!(
            lines_of(b"0123456789\n", 10).await,
            vec![Some(b"0123456789".to_vec())]
        );
    }

    #[tokio::test]
    async fn overlong_line_split_across_buffer_reads_is_dropped() {
        // BufReader 용량(4바이트)보다 긴 줄이 여러 번에 걸쳐 들어와도 상한을 지킨다
        let input: &[u8] = b"abcdefghijkl\nxy\n";
        let mut reader = tokio::io::BufReader::with_capacity(4, input);
        let mut line = Vec::new();
        let mut out = Vec::new();
        while let Some(fits) = read_line_capped(&mut reader, &mut line, 6).await.unwrap() {
            out.push(fits.then(|| line.clone()));
        }
        assert_eq!(out, vec![None, Some(b"xy".to_vec())]);
    }

    #[tokio::test]
    async fn read_events_routes_ready_and_skips_garbage() {
        let mut input = Vec::new();
        input.extend_from_slice(b"not json\n");
        input.extend_from_slice(b"{\"type\": \"notify\", \"title\": \"\xff\", \"body\": \"b\"}\n");
        input.extend_from_slice(b"{\"type\": \"mystery\"}\n");
        input.extend_from_slice(&[b'x'; MAX_LINE_BYTES + 1]);
        input.extend_from_slice(b"\n{\"type\": \"ready\", \"port\": 4321}\r\n");
        input.extend_from_slice(
            "{\"type\": \"notify\", \"title\": \"제목\", \"body\": \"본문\", \"route\": null}\n"
                .as_bytes(),
        );
        input.extend_from_slice(b"{\"type\": \"log\", \"msg\": \"m\"}");

        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = seen.clone();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        read_events(
            &input[..],
            tx,
            Arc::new(move |event| sink.lock().unwrap().push(event)),
        )
        .await;

        assert_eq!(rx.recv().await, Some(4321));
        assert_eq!(rx.recv().await, None);
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 2);
        assert_eq!(
            seen[0],
            SidecarEvent::Notify {
                title: "제목".into(),
                body: "본문".into(),
                route: None,
            }
        );
        assert!(matches!(seen[1], SidecarEvent::Log(_)));
    }

    #[test]
    fn info_debug_hides_the_token() {
        let info = SidecarInfo {
            state: SidecarState::Ready,
            port: Some(1234),
            token: Some("secret-token-value".into()),
        };
        let shown = format!("{info:?}");
        assert!(!shown.contains("secret-token-value"));
        assert!(shown.contains("1234"));
    }

    #[test]
    fn default_config_matches_the_spec() {
        let config = ManagerConfig::default();
        assert_eq!(config.ready_timeout, Duration::from_secs(60));
        assert_eq!(config.shutdown_grace, Duration::from_secs(5));
    }
}
