import { describe, expect, it } from 'vitest';
import {
  directionOf,
  formatEok,
  formatEokChange,
  formatNumber,
  formatPercent,
  formatPrice,
  formatPriceChange,
  formatSigned,
  formatUsd,
  formatUsdChange,
  formatWon,
  formatWonChange,
  MINUS,
  MISSING,
} from './money';

// 기대값은 일부러 글자 그대로 쓴다. 음수 부호는 하이픈(-)이 아니라 빼기 기호(U+2212 "−")다.
describe('표기에 쓰는 기호', () => {
  it('빼기 기호는 U+2212, 빠진 값은 U+2014', () => {
    expect(MINUS).toBe('−');
    expect(MISSING).toBe('—');
  });
});

describe('formatWon: 원화 금액 (스펙 9-1: 천 단위 구분자 + "원")', () => {
  it.each([
    [71400, '71,400원'],
    [198700, '198,700원'],
    [0, '0원'],
    [1234567, '1,234,567원'],
    [999, '999원'],
    [70000.4, '70,000원'],
    [70000.5, '70,001원'],
    [-1200, '−1,200원'],
    [null, '—'],
    [undefined, '—'],
    [Number.NaN, '—'],
    [Number.POSITIVE_INFINITY, '—'],
  ])('%s → %s', (value, expected) => {
    expect(formatWon(value)).toBe(expected);
  });
});

describe('formatWonChange: 원화 변화량 (부호 항상, 표 안에서는 "원" 없이)', () => {
  it.each([
    [1200, '+1,200'],
    [-3300, '−3,300'],
    [0, '0'],
    [-0, '0'],
    [21000, '+21,000'],
    [null, '—'],
  ])('%s → %s', (value, expected) => {
    expect(formatWonChange(value)).toBe(expected);
  });

  it('문장 안에서는 unit 옵션으로 "원"을 붙인다', () => {
    expect(formatWonChange(1200, { unit: true })).toBe('+1,200원');
    expect(formatWonChange(-3300, { unit: true })).toBe('−3,300원');
    expect(formatWonChange(0, { unit: true })).toBe('0원');
  });
});

describe('formatUsd: 달러 금액 (스펙 9-1: "$" + 소수점 2자리)', () => {
  it.each([
    [227.48, '$227.48'],
    [135.4, '$135.40'],
    [0, '$0.00'],
    [1234.5, '$1,234.50'],
    [1000000, '$1,000,000.00'],
    [-1.87, '−$1.87'],
    [null, '—'],
  ])('%s → %s', (value, expected) => {
    expect(formatUsd(value)).toBe(expected);
  });
});

describe('formatUsdChange: 달러 변화량 (부호는 $ 앞)', () => {
  it.each([
    [2.13, '+$2.13'],
    [-1.87, '−$1.87'],
    [0, '$0.00'],
    [12.5, '+$12.50'],
    [null, '—'],
  ])('%s → %s', (value, expected) => {
    expect(formatUsdChange(value)).toBe(expected);
  });
});

describe('formatPercent: 등락률 (부호 + 소수점 2자리, 입력은 퍼센트 값)', () => {
  it.each([
    [1.71, '+1.71%'],
    [-1.63, '−1.63%'],
    [0, '0.00%'],
    [-0, '0.00%'],
    [0.84, '+0.84%'],
    [-0.37, '−0.37%'],
    [30, '+30.00%'],
    [1234.5, '+1,234.50%'],
    // 아주 작은 변화도 방향을 지우지 않는다: 색과 부호가 늘 같이 간다
    [0.004, '+0.00%'],
    [-0.004, '−0.00%'],
    [null, '—'],
  ])('%s → %s', (value, expected) => {
    expect(formatPercent(value)).toBe(expected);
  });
});

describe('formatNumber / formatSigned: 지수 같은 단위 없는 숫자', () => {
  it.each([
    [2583.27, 2, '2,583.27'],
    [742.15, 2, '742.15'],
    [742.1, 2, '742.10'],
    [1500, 0, '1,500'],
    [null, 2, '—'],
  ])('formatNumber(%s, %s) → %s', (value, decimals, expected) => {
    expect(formatNumber(value, decimals)).toBe(expected);
  });

  it.each([
    [21.48, 2, '+21.48'],
    [-2.76, 2, '−2.76'],
    [0, 2, '0.00'],
    [3, 0, '+3'],
    [null, 2, '—'],
  ])('formatSigned(%s, %s) → %s', (value, decimals, expected) => {
    expect(formatSigned(value, decimals)).toBe(expected);
  });
});

describe('formatEokChange: 수급 금액을 억 단위로 (입력은 원)', () => {
  // 10억 미만은 소수 1자리, 10억부터 정수(천 단위 구분). 0이 아니면 반올림해 0이어도 부호를 남긴다.
  it.each([
    [0, '0.0억'],
    [4_000_000, '+0.0억'],
    [-4_000_000, '−0.0억'],
    [40_000_000, '+0.4억'],
    [-40_000_000, '−0.4억'],
    [-320_000_000, '−3.2억'],
    [990_000_000, '+9.9억'],
    [996_000_000, '+10억'],
    [-996_000_000, '−10억'],
    [1_000_000_000, '+10억'],
    [-1_000_000_000, '−10억'],
    [312_400_000_000, '+3,124억'],
    [-98_700_000_000, '−987억'],
    [-201_300_000_000, '−2,013억'],
    [null, '—'],
  ])('%s → %s', (value, expected) => {
    expect(formatEokChange(value)).toBe(expected);
  });

  it('부호와 방향이 늘 같다(빨강·파랑 "0억"이 나오지 않는다)', () => {
    for (const won of [4_000_000, -4_000_000, 40_000_000, -40_000_000]) {
      const text = formatEokChange(won);
      expect(text.startsWith(directionOf(won) === 'up' ? '+' : '−')).toBe(true);
    }
  });
});

describe('formatPrice / formatPriceChange: 통화에 맞춰 고른다', () => {
  it.each([
    [71400, 'KRW', '71,400원'],
    [227.48, 'USD', '$227.48'],
  ] as const)('formatPrice(%s, %s) → %s', (value, currency, expected) => {
    expect(formatPrice(value, currency)).toBe(expected);
  });

  it.each([
    [1200, 'KRW', '+1,200'],
    [-1.87, 'USD', '−$1.87'],
  ] as const)('formatPriceChange(%s, %s) → %s', (value, currency, expected) => {
    expect(formatPriceChange(value, currency)).toBe(expected);
  });
});

describe('directionOf: 상승·하락·보합', () => {
  it.each([
    [1200, 'up'],
    [0.004, 'up'],
    [-1.87, 'down'],
    [0, 'flat'],
    [-0, 'flat'],
    [null, 'flat'],
    [Number.NaN, 'flat'],
  ] as const)('%s → %s', (value, expected) => {
    expect(directionOf(value)).toBe(expected);
  });
});

describe('formatEok: 부호 없는 억 표기 (금액 자체, 입력은 원)', () => {
  // formatEokChange와 같은 자릿수 규칙. 양수에 +를 붙이지 않고, 음수만 빼기 기호.
  it.each([
    [0, '0.0억'],
    [40_000_000, '0.4억'],
    [-40_000_000, '−0.4억'],
    [996_000_000, '10억'],
    [312_400_000_000, '3,124억'],
    [-98_700_000_000, '−987억'],
    [null, '—'],
    [Number.NaN, '—'],
  ])('%s → %s', (value, expected) => {
    expect(formatEok(value)).toBe(expected);
  });
});
