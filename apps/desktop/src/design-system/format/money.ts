/**
 * 숫자 표기 (스펙 9-1).
 *
 * - 원화: 천 단위 구분자 + "원" (`71,400원`). 변화량은 표 안에서 "원" 없이 부호만 (`+1,200`).
 * - 수급: 억 단위. 10억 미만 소수 1자리(`+0.4억`), 10억부터 정수(`+3,124억`).
 * - 달러: `$` + 소수점 2자리 (`$227.48`). 변화량은 부호를 `$` 앞에 (`+$2.13`).
 * - 등락률: 부호 + 소수점 2자리 (`+1.71%`). 입력은 퍼센트 값이다(1.71 = 1.71%).
 * - 음수 부호는 하이픈이 아니라 빼기 기호 `−`(U+2212)다. 고정폭 숫자에서 `+`와 너비가 같다.
 * - 0은 부호 없이 `0`, `0.00%`. 0이 아니면 반올림해서 0이 되어도 부호를 남긴다(색과 부호가 늘 같이 간다).
 * - 값이 없거나 숫자가 아니면 `—`(U+2014). 화면은 이 자리에 "데이터 없음"을 읽어 준다.
 *
 * 모두 순수 함수다. 화면 컴포넌트는 이 함수의 결과만 쓰고 직접 숫자를 꾸미지 않는다.
 */

export const MINUS = '\u2212'; // 빼기 기호 −
export const MISSING = '\u2014'; // 줄표 —

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

/**
 * 수급처럼 큰 원화 변화량을 억 단위로. 입력은 원이다.
 * 10억 미만은 소수 1자리(`+0.4억`, `−3.2억`), 10억부터는 정수와 천 단위 구분(`+3,124억`).
 * 반올림해 소수 1자리가 10.0이 되면(9.96억) 정수 표기 `+10억`으로 올린다.
 * formatSigned와 같이 0이 아니면 반올림해 0이어도 부호를 남긴다(`+0.0억`), 0은 `0.0억`.
 */
export function formatEokChange(won: MaybeNumber): string {
  if (!isPresent(won)) return MISSING;
  const eok = Math.abs(won) / 1e8;
  const oneDecimal = grouped(eok, 1);
  const body = Number(oneDecimal.replace(/,/g, '')) < 10 ? oneDecimal : grouped(eok, 0);
  return `${signOf(won, true)}${body}억`;
}

/**
 * 부호 없는 억 표기(금액 자체: 거래대금, 시가총액 등). 입력은 원이다.
 * 자릿수 규칙은 formatEokChange와 같고, 양수에 `+`를 붙이지 않는다. 음수만 `−`.
 */
export function formatEok(won: MaybeNumber): string {
  if (!isPresent(won)) return MISSING;
  return formatEokChange(won).replace(/^\+/, '');
}

/** 통화에 맞는 가격 표기. */
export function formatPrice(value: MaybeNumber, currency: Currency): string {
  return currency === 'KRW' ? formatWon(value) : formatUsd(value);
}

/** 통화에 맞는 변화량 표기(표 안에서 쓰는 형태). */
export function formatPriceChange(value: MaybeNumber, currency: Currency): string {
  return currency === 'KRW' ? formatWonChange(value) : formatUsdChange(value);
}

/**
 * 보유 수량. 국내는 보통 정수(API가 소수를 주면 그대로), 미국은 소수점(필요한 만큼, 최대 8자리): `1,500`, `0.5`.
 * 입력은 사이드카의 십진 문자열이나 숫자다. 단위 "주"는 부르는 쪽이 붙인다.
 */
export function formatQuantity(value: string | number | null | undefined, market: string): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (value === '' || !isPresent(n)) return MISSING;
  // 국내도 API가 소수를 주면 숨기지 않는다(입력은 정수만 받지만 증권사가 소수를 줄 수 있다)
  if (market !== 'US' && Number.isInteger(n)) return signOf(n, false) + grouped(Math.abs(n), 0);
  const text = grouped(Math.abs(n), 8).replace(/\.?0+$/, '');
  return signOf(n, false) + text;
}

/**
 * 비율(퍼센트 값) 여러 개를 소수점 1자리로 보이되 합이 100.0이 되게 한다(가장 큰 나머지부터 0.1을 더함).
 * 칩을 수량에서 비율로 바꿔도 33.3 / 66.7처럼 어색하지 않게 하려는 것이다.
 */
export function formatShares(percents: number[]): string[] {
  const tenths = percents.map((p) => Math.floor(p * 10 + 1e-9));
  let left =
    Math.round(percents.reduce((a, b) => a + b, 0) * 10) - tenths.reduce((a, b) => a + b, 0);
  const order = percents
    .map((p, i) => [p * 10 - (tenths[i] as number), i] as const)
    .sort((a, b) => b[1] - a[1])
    .sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    tenths[i] = (tenths[i] as number) + 1;
    left -= 1;
  }
  return tenths.map((t) => `${(t / 10).toFixed(1)}%`);
}
