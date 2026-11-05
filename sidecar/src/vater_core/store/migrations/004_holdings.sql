-- 004: 증권사 연결과 보유 내역 (core/holdings, v2 설계 1, 2, 5장).
-- 키·시크릿·계좌번호 원문은 여기 두지 않는다(비밀키 저장소). 수량과 평단가는 소수 문자열로 저장한다.

CREATE TABLE brokers (
    id      TEXT PRIMARY KEY,
    name    TEXT NOT NULL UNIQUE,
    color   TEXT NOT NULL,
    kind    TEXT NOT NULL CHECK (kind IN ('api', 'manual')),
    builtin INTEGER NOT NULL DEFAULT 0
);

INSERT INTO brokers (id, name, color, kind, builtin) VALUES
    ('kis',     '한국투자', '#7B634F', 'api',    1),
    ('meritz',  '메리츠',   '#D14C34', 'api',    1),
    ('kiwoom',  '키움',     '#D4467D', 'api',    1),
    ('samsung', '삼성',     '#1C2FA7', 'manual', 1),
    ('mirae',   '미래에셋', '#D97A00', 'manual', 1);

CREATE TABLE connections (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,  -- 지운 번호를 다시 쓰면 진행 중인 동기화가 남의 연결에 기록한다
    broker_id      TEXT NOT NULL REFERENCES brokers (id),
    account_mask   TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'lost', 'disconnected')),
    last_synced_at TEXT,
    last_error     TEXT
);

CREATE TABLE holdings (
    id            INTEGER PRIMARY KEY,
    broker_id     TEXT NOT NULL REFERENCES brokers (id),
    connection_id INTEGER NOT NULL DEFAULT 0,  -- 0 = 수동 입력·CSV
    market        TEXT NOT NULL,               -- KR, US, 그 밖의 시장은 OTHER
    code          TEXT NOT NULL,
    name          TEXT NOT NULL,
    quantity      TEXT NOT NULL,
    avg_price     TEXT,
    currency      TEXT NOT NULL,
    source        TEXT NOT NULL CHECK (source IN ('api', 'manual', 'csv')),
    updated_at    TEXT NOT NULL,
    UNIQUE (broker_id, connection_id, market, code)
);
CREATE INDEX holdings_by_symbol ON holdings (market, code);

-- 업로드 확인 창에서 이미 본 종목. 여기 없는 보유 종목이 "새 종목"이다 (v2 설계 2장).
CREATE TABLE holdings_seen (
    market TEXT NOT NULL,
    code   TEXT NOT NULL,
    PRIMARY KEY (market, code)
);

CREATE INDEX symbols_by_code ON symbols (code);  -- CSV는 시장 없이 코드만으로 찾는다
