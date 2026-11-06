"""V11용: `v0.1.0` 태그의 마이그레이션(001~003)만으로 DB를 만들고 0.1.0 사용자가 쌓았을 데이터를 넣는다.

사용: python v010_db.py <데이터 폴더> <v0.1.0 마이그레이션 sql 폴더> <대시보드 문서 json>
실행기는 0.1.0의 `store/db.py`와 같다(schema_version에 번호를 적고 스크립트를 한 트랜잭션으로 돌린다).
현재 코드를 쓰지 않으므로 표준 라이브러리만 쓴다.
"""

import json
import sqlite3
import sys
from pathlib import Path


def main() -> None:
    data_dir, sql_dir, doc = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    data_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(data_dir / "vater.db")
    conn.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")
    for sql_file in sorted(sql_dir.glob("[0-9][0-9][0-9]_*.sql")):
        version = int(sql_file.name[:3])
        conn.executescript(
            f"BEGIN;\n{sql_file.read_text(encoding='utf-8')}\n"
            f"INSERT INTO schema_version (version) VALUES ({version});\nCOMMIT;"
        )
    conn.executemany(
        "INSERT INTO symbols (market, code, exchange, name, name_en, kind) VALUES (?,?,?,?,?,?)",
        [
            ("KR", "005930", "KOSPI", "삼성전자", "SAMSUNG ELECTRONICS", "stock"),
            ("KR", "000660", "KOSPI", "SK하이닉스", "SK HYNIX", "stock"),
            ("KR", "035420", "KOSPI", "NAVER", "NAVER", "stock"),
            ("US", "AAPL", "NAS", "애플", "APPLE INC", "stock"),
            ("US", "NVDA", "NAS", "엔비디아", "NVIDIA CORP", "stock"),
        ],
    )
    conn.executemany(
        "INSERT INTO watchlist (id, market, code, exchange, name) VALUES (?,?,?,?,?)",
        [(1, "KR", "005930", "KOSPI", "삼성전자"), (2, "US", "AAPL", "NAS", "애플")],
    )
    conn.executemany(
        "INSERT INTO alert_rules (id, watchlist_id, kind, params, timing, enabled, last_state, "
        "last_fired_at) VALUES (?,?,?,?,?,?,?,?)",
        [
            (1, 1, "price_above", '{"price": 90000}', "realtime", 1, 1, "2026-11-01T10:00:00+09:00"),
            (2, 2, "change_pct", '{"pct": 3.0, "direction": "both"}', "realtime", 0, 0, None),
        ],
    )
    conn.execute(
        "INSERT INTO alert_events (id, rule_id, fired_at, value, message) VALUES (?,?,?,?,?)",
        (1, 1, "2026-11-01T10:00:00+09:00", 91000.0, "삼성전자 현재가 91,000 — 목표가 90,000 이상"),
    )
    conn.execute(
        "INSERT INTO analyses (id, market, code, as_of, preset, models, status, decision, summary, "
        "reports, timings, tokens) VALUES (1, 'KR', '005930', '2026-10-30', 'cloud', '{}', 'done', "
        "'Buy', ?, ?, '{}', '{}')",
        (
            json.dumps({"lines": ["한 줄", "두 줄", "세 줄"], "price_target": "100000"}),
            json.dumps({"final_trade_decision": "**Rating**: Buy"}),
        ),
    )
    conn.execute(
        "INSERT INTO briefings (id, market, date, data, text, status, missing) VALUES "
        "(1, 'KR', '2026-10-30', ?, ?, 'done', '[]')",
        (
            json.dumps({"market": "KR", "session": "2026-10-30", "indices": [], "watchlist": []}),
            json.dumps({"headline": "0.1.0에서 만든 브리핑입니다."}),
        ),
    )
    settings = {
        "alerts.poll_interval_sec": 10,
        "briefing.kr.enabled": False,
        "ui.dashboards": json.loads(doc.read_text(encoding="utf-8")),
    }
    conn.executemany(
        "INSERT INTO settings (key, value) VALUES (?, ?)",
        [(k, json.dumps(v)) for k, v in settings.items()],
    )
    conn.commit()
    version = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0]
    conn.close()
    print(json.dumps({"schema_version": version}))


if __name__ == "__main__":
    main()
