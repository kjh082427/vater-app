-- 006: 자산 추이와 환율 (core/portfolio, v2 설계 12장). 환율은 하루 한 시점만 둔다.
CREATE TABLE fx_daily (
    day    TEXT PRIMARY KEY,
    usdkrw REAL NOT NULL
);

CREATE TABLE portfolio_daily (
    day        TEXT PRIMARY KEY,
    kr_value   REAL,
    kr_cost    REAL,
    us_value   REAL,
    us_cost    REAL,
    usdkrw     REAL,
    backfilled INTEGER NOT NULL DEFAULT 0
);
