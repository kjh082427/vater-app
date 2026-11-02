-- 002: 종목 마스터 (core/kis). 한투 마스터 파일로 하루 1번 통째로 갱신한다.

CREATE TABLE symbols (
    market   TEXT NOT NULL CHECK (market IN ('KR', 'US')),
    code     TEXT NOT NULL,
    exchange TEXT NOT NULL,      -- KOSPI|KOSDAQ / NAS|NYS|AMS
    name     TEXT NOT NULL,      -- 한글명
    name_en  TEXT,               -- 영문명 (해외만)
    kind     TEXT NOT NULL,      -- stock|etf
    PRIMARY KEY (market, code)
);
CREATE INDEX symbols_by_name ON symbols (name);

CREATE TABLE symbols_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
