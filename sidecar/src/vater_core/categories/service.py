"""분류표 조회. catalog.json은 처음 쓸 때 한 번 읽는다(앱 시작을 늦추지 않는다).

종목의 이름·상장 여부는 종목 마스터(symbols 테이블)가 기준이다. 분류표에는 코드만 있고,
마스터에 없는 코드(상장 폐지)는 결과에서 빠진다. 보유 내역 등 개인 자료는 쓰지 않는다.
"""

import json
import sqlite3
from dataclasses import dataclass
from functools import cache
from importlib.resources import files
from typing import Any, Literal

from vater_core.kis.master import Symbol, search_symbols

UNCLASSIFIED = "unclassified"
Market = Literal["KR", "US", "ALL"]


@dataclass(frozen=True)
class Node:
    id: str
    name: str
    level: Literal["group", "mid"]
    parent: str | None  # 중분류의 대분류 이름
    keywords: tuple[str, ...]
    kr: frozenset[str]
    us: frozenset[str]


class Catalog:
    def __init__(self, raw: dict[str, Any]) -> None:
        self.groups: list[tuple[Node, list[Node]]] = []
        self.nodes: dict[str, Node] = {}
        self.mids_of: dict[tuple[str, str], list[str]] = {}  # (시장, 코드) → 중분류 id들
        for g in raw["groups"]:
            mids = [
                Node(
                    m["id"],
                    m["name"],
                    "mid",
                    g["name"],
                    tuple(m["keywords"]),
                    frozenset(m["kr"]),
                    frozenset(m["us"]),
                )
                for m in g["mids"]
            ]
            group = Node(
                g["id"],
                g["name"],
                "group",
                None,
                (),
                frozenset().union(*(m.kr for m in mids)),
                frozenset().union(*(m.us for m in mids)),
            )
            self.groups.append((group, mids))
            for n in [group, *mids]:
                self.nodes[n.id] = n
            for m in mids:
                for market, codes in (("KR", m.kr), ("US", m.us)):
                    for code in codes:
                        self.mids_of.setdefault((market, code), []).append(m.id)


@cache
def load_catalog() -> Catalog:
    text = files("vater_core.categories").joinpath("catalog.json").read_text(encoding="utf-8")
    return Catalog(json.loads(text))


@dataclass(frozen=True)
class CategoryStock:
    symbol: Symbol
    mids: list[str]


def _rows(conn: sqlite3.Connection, sql: str, *args: Any) -> list[Symbol]:
    return [Symbol(*r) for r in conn.execute(sql, args).fetchall()]


def _listed(conn: sqlite3.Connection, market: str, codes: frozenset[str]) -> list[Symbol]:
    return _rows(
        conn,
        "SELECT market, code, exchange, name, name_en, kind FROM symbols "
        "WHERE market = ? AND kind = 'stock' AND code IN (SELECT value FROM json_each(?))",
        market,
        json.dumps(sorted(codes)),
    )


def stocks_of(
    conn: sqlite3.Connection, cat: Catalog, node_id: str, market: Market
) -> list[CategoryStock] | None:
    """분류 아래 모든 종목(대분류는 중분류의 합집합). 모르는 분류면 None."""
    markets = ("KR", "US") if market == "ALL" else (market,)
    if node_id == UNCLASSIFIED:
        syms = [
            s
            for m in markets
            for s in _rows(
                conn,
                "SELECT market, code, exchange, name, name_en, kind FROM symbols "
                "WHERE market = ? AND kind = 'stock'",
                m,
            )
            if (s.market, s.code) not in cat.mids_of
        ]
    elif node_id in cat.nodes:
        node = cat.nodes[node_id]
        syms = [s for m in markets for s in _listed(conn, m, node.kr if m == "KR" else node.us)]
    else:
        return None
    syms.sort(
        key=lambda s: (s.market != "KR", s.name)
    )  # ponytail: 전체 반환. 목록이 아주 길어지면 페이지로
    return [CategoryStock(s, cat.mids_of.get((s.market, s.code), [])) for s in syms]


@dataclass(frozen=True)
class NodeHit:
    node: Node
    match: Literal["name", "keyword"]
    keyword: str | None
    count: int


def search(
    conn: sqlite3.Connection, cat: Catalog, q: str, market: Market
) -> tuple[list[NodeHit], list[CategoryStock]]:
    """분류 이름·테마 키워드가 q를 포함하는 분류와, 이름·코드가 맞는 종목(분류 없는 종목 포함)."""
    ql = q.strip().lower()
    hits: list[NodeHit] = []
    for group, mids in cat.groups:
        for n in [group, *mids]:
            kw = next((k for k in n.keywords if ql in k.lower()), None)
            if ql in n.name.lower() or kw:
                match: Literal["name", "keyword"] = "name" if ql in n.name.lower() else "keyword"
                count = len(stocks_of(conn, cat, n.id, market) or [])
                if count:  # 그 시장에 상장된 종목이 없는 분류는 뺀다
                    hits.append(NodeHit(n, match, None if match == "name" else kw, count))
    syms = [
        s
        for s in search_symbols(conn, q, limit=200)
        if s.kind == "stock" and market in ("ALL", s.market)
    ][:50]
    return hits, [CategoryStock(s, cat.mids_of.get((s.market, s.code), [])) for s in syms]
