-- 003: 알림 지표 계산용 일봉 (core/alerts). 감시 종목마다 최근 약 260거래일, 장 마감 후 하루 1번 갱신한다.

CREATE TABLE daily_bars (
    market TEXT NOT NULL CHECK (market IN ('KR', 'US')),
    code   TEXT NOT NULL,
    day    TEXT NOT NULL,        -- YYYY-MM-DD (그 시장의 현지 날짜)
    open   REAL NOT NULL,
    high   REAL NOT NULL,
    low    REAL NOT NULL,
    close  REAL NOT NULL,
    volume INTEGER NOT NULL,
    PRIMARY KEY (market, code, day)
);
