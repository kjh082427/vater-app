import type { ConnectionOut, HoldingOut } from '../api/types';

/** 시험용 보유 한 줄. 필요한 값만 바꿔 쓴다. */
export function holding(over: Partial<HoldingOut> & Pick<HoldingOut, 'code' | 'name'>): HoldingOut {
  return {
    broker_id: 'kis',
    connection_id: 1,
    market: 'KR',
    quantity: '10',
    avg_price: 64000,
    currency: 'KRW',
    source: 'api',
    updated_at: '2026-11-06T14:00:00+09:00',
    supported: true,
    unsupported_reason: null,
    is_new: false,
    ...over,
  };
}

export function connection(
  over: Partial<ConnectionOut> & Pick<ConnectionOut, 'id' | 'broker_id'>,
): ConnectionOut {
  return {
    account_mask: '****1234',
    status: 'ok',
    last_synced_at: '2026-11-06T14:00:00+09:00',
    last_error: null,
    server: null,
    ...over,
  };
}
