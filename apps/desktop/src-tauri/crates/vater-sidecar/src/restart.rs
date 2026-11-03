//! 사이드카 재시작 정책 (스펙 2-1).
//!
//! 비정상 종료면 다시 실행하되, 10분 안에 3회를 넘으면 멈추고 UI에 오류 상태를 보인다.
//! 다시 실행하기 전에는 1·2·4초로 늘어나는 대기(지수 백오프)를 둔다.
//! 시각은 호출하는 쪽이 넘기므로(`now`) 테스트에서 시간을 마음대로 정할 수 있다.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

/// 종료 뒤 무엇을 할지.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// `delay`만큼 기다린 뒤 다시 실행한다.
    Restart { delay: Duration },
    /// 재시작을 멈춘다(오류 상태).
    GiveUp,
}

/// 최근 `window` 동안의 비정상 종료 횟수와 연속 실패 횟수(백오프)를 기억한다.
#[derive(Debug, Clone)]
pub struct RestartPolicy {
    window: Duration,
    max: usize,
    base_delay: Duration,
    max_delay: Duration,
    exits: VecDeque<Instant>,
    streak: u32,
}

impl RestartPolicy {
    /// 운영 값: 10분 안에 3회까지 재시작.
    pub const WINDOW: Duration = Duration::from_secs(600);
    pub const MAX_RESTARTS: usize = 3;
    /// 백오프 1·2·4초 (4초에서 멈춘다).
    pub const BASE_DELAY: Duration = Duration::from_secs(1);
    pub const MAX_DELAY: Duration = Duration::from_secs(4);

    /// `window` 안에서 `max`회까지 재시작을 허용한다. 백오프는 운영 값(1·2·4초).
    pub fn new(window: Duration, max: usize) -> Self {
        Self {
            window,
            max,
            base_delay: Self::BASE_DELAY,
            max_delay: Self::MAX_DELAY,
            exits: VecDeque::new(),
            streak: 0,
        }
    }

    /// 백오프의 첫 대기와 상한을 바꾼다(테스트용으로 짧게).
    pub fn with_backoff(mut self, base_delay: Duration, max_delay: Duration) -> Self {
        self.base_delay = base_delay;
        self.max_delay = max_delay;
        self
    }

    /// 사이드카가 (요청하지 않았는데) 끝났다.
    pub fn on_exit(&mut self, now: Instant) -> Decision {
        while let Some(&oldest) = self.exits.front() {
            if now.saturating_duration_since(oldest) >= self.window {
                self.exits.pop_front();
            } else {
                break;
            }
        }
        self.exits.push_back(now);
        if self.exits.len() > self.max {
            return Decision::GiveUp;
        }
        let factor = 2u32.saturating_pow(self.streak);
        let delay = self.base_delay.saturating_mul(factor).min(self.max_delay);
        self.streak = self.streak.saturating_add(1);
        Decision::Restart { delay }
    }

    /// 사이드카가 `ready`를 보냈다. 백오프만 처음으로 되돌린다(10분 창의 횟수는 그대로).
    pub fn on_ready(&mut self) {
        self.streak = 0;
    }
}

impl Default for RestartPolicy {
    fn default() -> Self {
        Self::new(Self::WINDOW, Self::MAX_RESTARTS)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn secs(n: u64) -> Duration {
        Duration::from_secs(n)
    }

    fn restart(delay_secs: u64) -> Decision {
        Decision::Restart {
            delay: secs(delay_secs),
        }
    }

    #[test]
    fn restarts_three_times_then_gives_up_on_the_fourth_exit() {
        let mut policy = RestartPolicy::default();
        let t0 = Instant::now();
        assert!(matches!(policy.on_exit(t0), Decision::Restart { .. }));
        assert!(matches!(
            policy.on_exit(t0 + secs(1)),
            Decision::Restart { .. }
        ));
        assert!(matches!(
            policy.on_exit(t0 + secs(3)),
            Decision::Restart { .. }
        ));
        assert_eq!(policy.on_exit(t0 + secs(7)), Decision::GiveUp);
    }

    #[test]
    fn fourth_exit_just_inside_ten_minutes_gives_up() {
        let mut policy = RestartPolicy::default();
        let t0 = Instant::now();
        for _ in 0..3 {
            assert!(matches!(policy.on_exit(t0), Decision::Restart { .. }));
        }
        assert_eq!(policy.on_exit(t0 + secs(599)), Decision::GiveUp);
    }

    #[test]
    fn exits_older_than_ten_minutes_no_longer_count() {
        let mut policy = RestartPolicy::default();
        let t0 = Instant::now();
        for _ in 0..3 {
            assert!(matches!(policy.on_exit(t0), Decision::Restart { .. }));
        }
        // 정확히 10분 뒤에는 처음 세 번이 창 밖으로 밀려난다
        assert!(matches!(
            policy.on_exit(t0 + secs(600)),
            Decision::Restart { .. }
        ));
    }

    #[test]
    fn window_slides_one_exit_at_a_time() {
        let mut policy = RestartPolicy::default();
        let t0 = Instant::now();
        assert!(matches!(policy.on_exit(t0), Decision::Restart { .. }));
        assert!(matches!(
            policy.on_exit(t0 + secs(300)),
            Decision::Restart { .. }
        ));
        assert!(matches!(
            policy.on_exit(t0 + secs(500)),
            Decision::Restart { .. }
        ));
        // t0의 종료만 창 밖: 창 안에는 300·500·650 → 3회, 허용
        assert!(matches!(
            policy.on_exit(t0 + secs(650)),
            Decision::Restart { .. }
        ));
        // 창 안에 300·500·650·700 → 4회, 멈춤
        assert_eq!(policy.on_exit(t0 + secs(700)), Decision::GiveUp);
    }

    #[test]
    fn backoff_doubles_one_two_four_seconds() {
        let mut policy = RestartPolicy::default();
        let t0 = Instant::now();
        assert_eq!(policy.on_exit(t0), restart(1));
        assert_eq!(policy.on_exit(t0 + secs(2)), restart(2));
        assert_eq!(policy.on_exit(t0 + secs(5)), restart(4));
    }

    #[test]
    fn backoff_is_capped_at_four_seconds() {
        // 창을 넓혀 재시작 횟수 제한에 걸리지 않게 하고 백오프 상한만 본다
        let mut policy = RestartPolicy::new(RestartPolicy::WINDOW, 10);
        let t0 = Instant::now();
        let delays: Vec<Decision> = (0..6).map(|i| policy.on_exit(t0 + secs(i))).collect();
        assert_eq!(
            delays,
            vec![
                restart(1),
                restart(2),
                restart(4),
                restart(4),
                restart(4),
                restart(4)
            ]
        );
    }

    #[test]
    fn ready_resets_backoff_but_not_the_window_count() {
        let mut policy = RestartPolicy::default();
        let t0 = Instant::now();
        assert_eq!(policy.on_exit(t0), restart(1));
        assert_eq!(policy.on_exit(t0 + secs(2)), restart(2));
        policy.on_ready();
        assert_eq!(policy.on_exit(t0 + secs(60)), restart(1));
        // 10분 안의 네 번째 종료: ready를 받았어도 멈춘다
        assert_eq!(policy.on_exit(t0 + secs(120)), Decision::GiveUp);
    }

    #[test]
    fn custom_backoff_for_tests() {
        let mut policy = RestartPolicy::new(secs(10), 2)
            .with_backoff(Duration::from_millis(10), Duration::from_millis(15));
        let t0 = Instant::now();
        assert_eq!(
            policy.on_exit(t0),
            Decision::Restart {
                delay: Duration::from_millis(10)
            }
        );
        assert_eq!(
            policy.on_exit(t0),
            Decision::Restart {
                delay: Duration::from_millis(15)
            }
        );
        assert_eq!(policy.on_exit(t0), Decision::GiveUp);
        // 짧은 창도 지나면 다시 허용
        assert!(matches!(
            policy.on_exit(t0 + secs(10)),
            Decision::Restart { .. }
        ));
    }
}
