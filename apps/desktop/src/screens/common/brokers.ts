import type { BrokerOut } from '../../api/types';

/** 증권사 이름과 색. 목록에 없으면(아직 못 받았거나 지워진 증권사) id와 회색을 쓴다. */
export function brokerInfo(
  brokers: BrokerOut[] | undefined,
  id: string,
): { id: string; name: string; color: string } {
  const b = brokers?.find((x) => x.id === id);
  return { id, name: b?.name ?? id, color: b?.color ?? '#7f8698' };
}
