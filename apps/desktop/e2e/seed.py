"""흐름 테스트용: 임시 데이터 폴더에 DB를 만들고 종목 몇 개를 심는다(종목 마스터를 받지 않게).

사용: uv run --project ../../sidecar python e2e/seed.py <data_dir>
"""

import sys
from pathlib import Path

from vater_core.store.db import open_db

SYMBOLS = [
    ("KR", "005930", "KOSPI", "삼성전자", "SAMSUNG ELECTRONICS", "stock"),
    ("KR", "000660", "KOSPI", "SK하이닉스", "SK HYNIX", "stock"),
    ("US", "AAPL", "NAS", "애플", "APPLE INC", "stock"),
]


def main() -> None:
    conn = open_db(Path(sys.argv[1]))
    conn.executemany(
        "INSERT INTO symbols (market, code, exchange, name, name_en, kind) VALUES (?,?,?,?,?,?)",
        SYMBOLS,
    )
    conn.commit()
    conn.close()


if __name__ == "__main__":
    main()
