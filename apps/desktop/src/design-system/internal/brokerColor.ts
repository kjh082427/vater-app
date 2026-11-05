/** 내장 증권사는 토큰 색, 직접 추가한 증권사는 사이드카가 정해 준 색(스펙 7장). */
const TOKEN: Record<string, string> = {
  kis: 'var(--color-broker-kis)',
  meritz: 'var(--color-broker-meritz)',
  kiwoom: 'var(--color-broker-kiwoom)',
  samsung: 'var(--color-broker-samsung)',
  mirae: 'var(--color-broker-mirae)',
};

export function brokerColor(id: string, given: string): string {
  return TOKEN[id] ?? given;
}
