import type { Decision } from '../../design-system';

const DECISIONS: readonly Decision[] = [
  'Buy',
  'Overweight',
  'Hold',
  'Underweight',
  'Sell',
  'REVIEW',
];

/** 사이드카 결정 문자열 → 의견 눈금 값. 6가지가 아니면 판단을 지어내지 않고 검토 필요. */
export function toDecision(value: string | null | undefined): Decision {
  return DECISIONS.includes(value as Decision) ? (value as Decision) : 'REVIEW';
}
