-- 001: 1차 버전 초기 스키마 (스펙 2-4)

CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL            -- JSON 문자열
);

CREATE TABLE watchlist (
    id         INTEGER PRIMARY KEY,
    market     TEXT NOT NULL CHECK (market IN ('KR', 'US')),
    code       TEXT NOT NULL,       -- 국내: 005930 / 미국: AAPL
    exchange   TEXT,                -- 국내: KOSPI|KOSDAQ / 미국: NAS|NYS|AMS
    name       TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (market, code)
);

CREATE TABLE alert_rules (
    id            INTEGER PRIMARY KEY,
    watchlist_id  INTEGER NOT NULL REFERENCES watchlist (id) ON DELETE CASCADE,
    kind          TEXT NOT NULL,     -- price_above, rsi_below, ma_cross ... (core/alerts에서 정의)
    params        TEXT NOT NULL DEFAULT '{}',
    timing        TEXT NOT NULL CHECK (timing IN ('realtime', 'close')),
    enabled       INTEGER NOT NULL DEFAULT 1,
    last_state    INTEGER,           -- 직전 평가 결과(0/1), 상태가 바뀔 때만 알림
    last_fired_at TEXT
);

CREATE TABLE alert_events (
    id       INTEGER PRIMARY KEY,
    rule_id  INTEGER REFERENCES alert_rules (id) ON DELETE SET NULL,
    fired_at TEXT NOT NULL,
    value    REAL,
    message  TEXT NOT NULL
);

CREATE TABLE analyses (
    id         INTEGER PRIMARY KEY,
    market     TEXT NOT NULL,
    code       TEXT NOT NULL,
    as_of      TEXT NOT NULL,
    preset     TEXT NOT NULL,
    models     TEXT,                -- JSON
    status     TEXT NOT NULL,       -- queued|running|done|failed|cancelled
    decision   TEXT,
    summary    TEXT,
    reports    TEXT,                -- JSON
    timings    TEXT,                -- JSON
    tokens     TEXT,                -- JSON
    error      TEXT,                -- JSON {code, message, hint}
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX analyses_by_code ON analyses (market, code, created_at);

CREATE TABLE briefings (
    id         INTEGER PRIMARY KEY,
    market     TEXT NOT NULL,
    date       TEXT NOT NULL,
    data       TEXT,                -- JSON (수집한 숫자 데이터, UI가 직접 표시)
    text       TEXT,                -- JSON (LLM 해석 문장)
    status     TEXT NOT NULL,
    missing    TEXT,                -- JSON 배열
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (market, date)
);
