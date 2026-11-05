"""증권사 어댑터: 보유 종목 조회만 한다. 주문·정정·취소 없음 (v2 설계 8장)."""

from vater_core.brokers import kiwoom as kiwoom  # 어댑터는 불러올 때 ADAPTERS에 등록된다
