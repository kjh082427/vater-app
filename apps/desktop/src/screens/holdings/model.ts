import type { HoldingOut } from '../../api/types';

export const holdingKey = (h: { market: string | null; code: string }) =>
  `${h.market ?? '?'}:${h.code}`;

export interface UploadRow {
  key: string;
  market: 'KR' | 'US' | null;
  code: string;
  name: string;
  /** 새 종목(확인 창에서 아직 보지 못함). */
  isNew: boolean;
  supported: boolean;
  reason: string | null;
  watched: boolean;
  /** 모든 증권사의 합계 수량. */
  quantity: number;
}

/**
 * 보유 내역을 종목 하나에 한 줄로 합친다(같은 종목이 여러 증권사에 있어도 감시 종목은 하나, 스펙 2장).
 * 판 종목(수량 0)은 뺀다. 정렬: 올릴 수 있는 새 종목 → 나머지 올릴 수 있는 것 → 막힌 것.
 */
export function uploadRows(holdings: HoldingOut[], watched: ReadonlySet<string>): UploadRow[] {
  const byKey = new Map<string, UploadRow>();
  for (const h of holdings) {
    const key = holdingKey(h);
    const row = byKey.get(key) ?? {
      key,
      market: h.market,
      code: h.code,
      name: h.name,
      isNew: false,
      supported: h.supported,
      reason: h.unsupported_reason,
      watched: watched.has(key),
      quantity: 0,
    };
    row.quantity += Number(h.quantity);
    row.isNew ||= h.is_new;
    byKey.set(key, row);
  }
  const rank = (r: UploadRow) => (!r.supported || r.watched ? 2 : r.isNew ? 0 : 1);
  return [...byKey.values()].filter((r) => r.quantity > 0).sort((a, b) => rank(a) - rank(b));
}

/** "새 종목 N개": 새 종목이면서 지원하고 아직 감시 중이 아닌 것(스펙 2장). */
export function newSymbolCount(holdings: HoldingOut[], watched: ReadonlySet<string>): number {
  return uploadRows(holdings, watched).filter((r) => r.isNew && r.supported && !r.watched).length;
}
