//! 사이드카 stdout 한 줄(JSON 이벤트 1개)을 해석한다 (스펙 2-2).
//!
//! 사이드카(`vater_core.stdout_events.emit`)는 `ready{port}`, `notify{title, body, route}`,
//! `log{...}`를 UTF-8 JSON 한 줄씩 쓴다. 셸은 어떤 줄이 와도 죽지 않아야 하므로,
//! 해석할 수 없는 줄은 `None`으로 돌려주고 호출하는 쪽은 그 줄을 건너뛴다.

use serde_json::Value;

/// 사이드카가 stdout으로 보낸 이벤트.
#[derive(Debug, Clone, PartialEq)]
pub enum SidecarEvent {
    /// 서버가 `127.0.0.1:port`에서 요청을 받을 준비가 됐다.
    Ready { port: u16 },
    /// Windows 알림을 띄워 달라는 요청. `route`는 알림을 눌렀을 때 열 화면.
    Notify {
        title: String,
        body: String,
        route: Option<String>,
    },
    /// 로그 이벤트. 받은 JSON 객체를 그대로 담는다.
    Log(Value),
    /// JSON 객체이고 `type`도 있지만 셸이 모르는 종류.
    Unknown,
}

/// 한 줄을 해석한다. 빈 줄, JSON이 아닌 줄, 형식이 맞지 않는 이벤트는 `None`.
pub fn parse_line(line: &str) -> Option<SidecarEvent> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    let value: Value = serde_json::from_str(line).ok()?;
    let object = value.as_object()?;
    match object.get("type")?.as_str()? {
        "ready" => {
            let port = object.get("port")?.as_u64()?;
            let port = u16::try_from(port).ok().filter(|p| *p != 0)?;
            Some(SidecarEvent::Ready { port })
        }
        "notify" => {
            let title = object.get("title")?.as_str()?.to_owned();
            let body = object.get("body")?.as_str()?.to_owned();
            let route = match object.get("route") {
                None | Some(Value::Null) => None,
                Some(Value::String(route)) => Some(route.clone()),
                Some(_) => return None,
            };
            Some(SidecarEvent::Notify { title, body, route })
        }
        "log" => Some(SidecarEvent::Log(value)),
        _ => Some(SidecarEvent::Unknown),
    }
}

/// stdout에서 읽은 바이트 한 줄을 해석한다. UTF-8이 깨진 줄은 `None`.
pub fn parse_bytes(line: &[u8]) -> Option<SidecarEvent> {
    parse_line(std::str::from_utf8(line).ok()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ready_line_exactly_as_the_sidecar_prints_it() {
        // Python json.dumps 기본 구분자(", ", ": ") 그대로
        assert_eq!(
            parse_line(r#"{"type": "ready", "port": 54321}"#),
            Some(SidecarEvent::Ready { port: 54321 })
        );
    }

    #[test]
    fn notify_with_korean_text_and_route() {
        // ensure_ascii=False 이므로 한국어가 그대로 온다
        let line = r#"{"type": "notify", "title": "삼성전자 RSI 30 이하", "body": "RSI가 28.4로 내려갔습니다.", "route": "/alerts/events"}"#;
        assert_eq!(
            parse_line(line),
            Some(SidecarEvent::Notify {
                title: "삼성전자 RSI 30 이하".into(),
                body: "RSI가 28.4로 내려갔습니다.".into(),
                route: Some("/alerts/events".into()),
            })
        );
    }

    #[test]
    fn notify_with_null_route() {
        let line = r#"{"type": "notify", "title": "브리핑 도착", "body": "오늘의 시장 브리핑", "route": null}"#;
        assert_eq!(
            parse_line(line),
            Some(SidecarEvent::Notify {
                title: "브리핑 도착".into(),
                body: "오늘의 시장 브리핑".into(),
                route: None,
            })
        );
    }

    #[test]
    fn notify_without_route_key_has_no_route() {
        let line = r#"{"type": "notify", "title": "t", "body": "b"}"#;
        assert_eq!(
            parse_line(line),
            Some(SidecarEvent::Notify {
                title: "t".into(),
                body: "b".into(),
                route: None,
            })
        );
    }

    #[test]
    fn notify_missing_title_or_body_is_rejected() {
        assert_eq!(parse_line(r#"{"type": "notify", "body": "b"}"#), None);
        assert_eq!(parse_line(r#"{"type": "notify", "title": "t"}"#), None);
        assert_eq!(
            parse_line(r#"{"type": "notify", "title": 1, "body": "b"}"#),
            None
        );
        assert_eq!(
            parse_line(r#"{"type": "notify", "title": "t", "body": "b", "route": 5}"#),
            None
        );
    }

    #[test]
    fn log_keeps_the_whole_object() {
        let line = r#"{"type": "log", "level": "info", "message": "시작"}"#;
        assert_eq!(
            parse_line(line),
            Some(SidecarEvent::Log(
                json!({"type": "log", "level": "info", "message": "시작"})
            ))
        );
    }

    #[test]
    fn surrounding_whitespace_and_crlf_are_ignored() {
        assert_eq!(
            parse_line("  {\"type\": \"ready\", \"port\": 8000}\r\n"),
            Some(SidecarEvent::Ready { port: 8000 })
        );
        assert_eq!(
            parse_line("{\"type\": \"ready\", \"port\": 8000}\r"),
            Some(SidecarEvent::Ready { port: 8000 })
        );
    }

    #[test]
    fn empty_and_blank_lines_are_none() {
        assert_eq!(parse_line(""), None);
        assert_eq!(parse_line("   \r\n"), None);
    }

    #[test]
    fn non_json_lines_are_none() {
        assert_eq!(
            parse_line("INFO: Uvicorn running on http://127.0.0.1"),
            None
        );
        assert_eq!(parse_line("{\"type\": \"ready\", \"port\": 1"), None);
        assert_eq!(parse_line("Traceback (most recent call last):"), None);
    }

    #[test]
    fn json_that_is_not_an_event_object_is_none() {
        assert_eq!(parse_line("[1, 2, 3]"), None);
        assert_eq!(parse_line("\"ready\""), None);
        assert_eq!(parse_line("42"), None);
        assert_eq!(parse_line("null"), None);
        assert_eq!(parse_line(r#"{"port": 54321}"#), None);
        assert_eq!(parse_line(r#"{"type": 1, "port": 54321}"#), None);
    }

    #[test]
    fn unknown_type_is_unknown() {
        assert_eq!(
            parse_line(r#"{"type": "progress", "pct": 40}"#),
            Some(SidecarEvent::Unknown)
        );
    }

    #[test]
    fn ready_port_out_of_range_is_none() {
        assert_eq!(parse_line(r#"{"type": "ready", "port": 0}"#), None);
        assert_eq!(parse_line(r#"{"type": "ready", "port": 70000}"#), None);
        assert_eq!(parse_line(r#"{"type": "ready", "port": -1}"#), None);
    }

    #[test]
    fn ready_port_must_be_an_integer() {
        assert_eq!(parse_line(r#"{"type": "ready"}"#), None);
        assert_eq!(parse_line(r#"{"type": "ready", "port": "54321"}"#), None);
        assert_eq!(parse_line(r#"{"type": "ready", "port": 54321.5}"#), None);
        assert_eq!(parse_line(r#"{"type": "ready", "port": null}"#), None);
    }

    #[test]
    fn ready_port_bounds_are_inclusive() {
        assert_eq!(
            parse_line(r#"{"type": "ready", "port": 1}"#),
            Some(SidecarEvent::Ready { port: 1 })
        );
        assert_eq!(
            parse_line(r#"{"type": "ready", "port": 65535}"#),
            Some(SidecarEvent::Ready { port: 65535 })
        );
    }

    #[test]
    fn bytes_with_broken_utf8_are_none() {
        // 0xFF는 UTF-8에 나올 수 없는 바이트
        let mut line = br#"{"type": "notify", "title": ""#.to_vec();
        line.push(0xFF);
        line.extend_from_slice(br#"", "body": "b"}"#);
        assert_eq!(parse_bytes(&line), None);
    }

    #[test]
    fn bytes_with_valid_utf8_are_parsed() {
        let line =
            "{\"type\": \"notify\", \"title\": \"알림\", \"body\": \"본문\", \"route\": null}\n";
        assert_eq!(
            parse_bytes(line.as_bytes()),
            Some(SidecarEvent::Notify {
                title: "알림".into(),
                body: "본문".into(),
                route: None,
            })
        );
    }
}
