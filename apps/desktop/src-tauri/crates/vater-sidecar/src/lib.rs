//! Vater 셸이 Python 사이드카(`vater-core`)를 다루는 순수 로직.
//!
//! Tauri 타입에 의존하지 않으므로 어느 운영체제에서나 `cargo test`로 확인한다.
//! Tauri 앱 크레이트(`apps/desktop/src-tauri`)가 이 크레이트를 경로 의존성으로 쓴다.

pub mod events;
pub mod launch;
pub mod restart;
