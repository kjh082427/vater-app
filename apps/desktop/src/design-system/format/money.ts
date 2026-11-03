/**
 * 숫자 표기 (스펙 9-1).
 *
 * - 원화: 천 단위 구분자 + "원" (`71,400원`). 변화량은 표 안에서 "원" 없이 부호만 (`+1,200`).
 * - 달러: `$` + 소수점 2자리 (`$227.48`). 변화량은 부호를 `$` 앞에 (`+$2.13`).
 * - 등락률: 부호 + 소수점 2자리 (`+1.71%`). 입력은 퍼센트 값이다(1.71 = 1.71%).
 * - 음수 부호는 하이픈이 아니라 빼기 기호 `−`(U+2212)다. 고정폭 숫자에서 `+`와 너비가 같다.
 * - 0은 부호 없이 `0`, `0.00%`. 0이 아니면 반올림해서 0이 되어도 부호를 남긴다(색과 부호가 늘 같이 간다).
 * - 값이 없거나 숫자가 아니면 `—`(U+2014). 화면은 이 자리에 "데이터 없음"을 읽어 준다.
 *
 * 모두 순수 함수다. 화면 컴포넌트는 이 함수의 결과만 쓰고 직접 숫자를 꾸미지 않는다.
 */

export const MINUS = '−';
export const MISSING = '—';

export type Direction = 'up' | 'down' | 'flat';
export type Currency = 'KRW' | 'USD';
type MaybeNumber = number | null | undefined;

const formatters = new Map<number, Intl.NumberFormat>();

function grouped(abs: number, decimals: number): string {
  let f = formatters.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat('ko-KR', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      roundingMode: 'halfExpand',
    });
    formatters.set(decimals, f);
  }
  return f.format(abs);
}

function isPresent(value: MaybeNumber): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 상승(>0), 하락(<0), 보합(0 또는 값 없음). */
export function directionOf(value: MaybeNumber): Direction {
  if (!isPresent(value) || value === 0) return 'flat';
  return value > 0 ? 'up' : 'down';
}

function signOf(value: number, plus: boolean): string {
  if (value > 0) return plus ? '+' : '';
  if (value < 0) return MINUS;
  return '';
}

/** 단위 없는 숫자: `2,583.27` (음수면 `−`). */
export function formatNumber(value: MaybeNumber, decimals = 0): string {
  if (!isPresent(value)) return MISSING;
  return signOf(value, false) + grouped(Math.abs(value), decimals);
}

/** 부호를 늘 붙인 숫자: `+21.48`, `−2.76`, `0.00`. */
export function formatSigned(value: MaybeNumber, decimals = 0): string {
  if (!isPresent(value)) return MISSING;
  return signOf(value, true) + grouped(Math.abs(value), decimals);
}

/** 원화 금액: `71,400원`. 원 단위로 반올림한다. */
export function formatWon(value: MaybeNumber): string {
  if (!isPresent(value)) return MISSING;
  return `${formatNumber(value, 0)}원`;
}

/** 원화 변화량: `+1,200`. 문장 안에서는 `{ unit: true }`로 `+1,200원`. */
export function formatWonChange(value: MaybeNumber, options: { unit?: boolean } = {}): string {
  if (!isPresent(value)) return MISSING;
  return formatSigned(value, 0) + (options.unit ? '원' : '');
}

/** 달러 금액: `$227.48`, 음수는 `−$1.87`. */
export function formatUsd(value: MaybeNumber): string {
  if (!isPresent(value)) return MISSING;
  return `${signOf(value, false)}$${grouped(Math.abs(value), 2)}`;
}

/** 달러 변화량: `+$2.13`, `−$1.87`, `$0.00`. */
export function formatUsdChange(value: MaybeNumber): string {
  if (!isPresent(value)) return MISSING;
  return `${signOf(value, true)}$${grouped(Math.abs(value), 2)}`;
}

/** 등락률: `+1.71%`, `−1.63%`, `0.00%`. 입력은 퍼센트 값(1.71)이다. */
export function formatPercent(value: MaybeNumber): string {
  if (!isPresent(value)) return MISSING;
  return `${formatSigned(value, 2)}%`;
}

/** 수급처럼 큰 원화 변화량을 억 단위로: `+3,124억`. 입력은 원이다. */
export function formatEokChange(won: MaybeNumber): string {
  if (!isPresent(won)) return MISSING;
  const eok = Math.round(Math.abs(won) / 1e8);
  if (eok === 0) return '0억';
  return `${signOf(won, true)}${grouped(eok, 0)}억`;
}

/** 통화에 맞는 가격 표기. */
export function formatPrice(value: MaybeNumber, currency: Currency): string {
  return currency === 'KRW' ? formatWon(value) : formatUsd(value);
}

/** 통화에 맞는 변화량 표기(표 안에서 쓰는 형태). */
export function formatPriceChange(value: MaybeNumber, currency: Currency): string {
  return currency === 'KRW' ? formatWonChange(value) : formatUsdChange(value);
}
