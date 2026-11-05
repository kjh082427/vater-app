"""한 종목의 평가 계산 (v2 설계 4-1장). 값이 없으면 지어내지 않고 None으로 둔다."""

from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class Valuation:
    value: float | None
    cost: float | None
    pl: float | None
    pl_pct: float | None


def value_of(
    total: Decimal, avg: Decimal | None, price: float | None, unpriced: Decimal = Decimal(0)
) -> Valuation:
    """`unpriced`는 평단가를 모르는 수량이다. 평가금액에는 넣고 손익에서는 뺀다."""
    now = Decimal(str(price)) if price is not None else None
    priced = total - unpriced
    cost = priced * avg if avg is not None else None
    pl = priced * now - cost if now is not None and cost is not None else None
    return Valuation(
        float(total * now) if now is not None else None,
        float(cost) if cost is not None else None,
        float(pl) if pl is not None else None,
        float(pl / cost * 100) if pl is not None and cost else None,
    )
