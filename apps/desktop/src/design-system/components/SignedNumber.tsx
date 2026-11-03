import {
  directionOf,
  formatEokChange,
  formatPercent,
  formatSigned,
  formatUsdChange,
  formatWonChange,
  MISSING,
  type Currency,
} from '../format/money';
import { cx } from '../internal/cx';
import styles from './SignedNumber.module.css';
import { VisuallyHidden } from './VisuallyHidden';

type MaybeNumber = number | null | undefined;

export type SignedFormat = 'won' | 'usd' | 'percent' | 'number' | 'eok';

export interface SignedNumberProps {
  value: MaybeNumber;
  /**
   * - `won`: `+1,200` (`unit`이면 `+1,200원`)
   * - `usd`: `+$2.13`
   * - `percent`: `+1.71%`
   * - `number`: `+21.48` (`decimals` 자리)
   * - `eok`: 원 → 억 단위 `+3,124억`
   */
  format: SignedFormat;
  decimals?: number;
  unit?: boolean;
  className?: string;
}

function text(value: MaybeNumber, format: SignedFormat, decimals: number, unit: boolean): string {
  switch (format) {
    case 'won':
      return formatWonChange(value, { unit });
    case 'usd':
      return formatUsdChange(value);
    case 'percent':
      return formatPercent(value);
    case 'number':
      return formatSigned(value, decimals);
    case 'eok':
      return formatEokChange(value);
  }
}

/**
 * 부호가 붙은 변화량 하나. 상승은 빨강, 하락은 파랑, 보합은 회색이고 부호가 늘 같이 붙는다.
 * 값이 없으면 `—`를 보여 주고 화면 읽기 프로그램에는 "데이터 없음"을 읽어 준다.
 */
export function SignedNumber({
  value,
  format,
  decimals = 0,
  unit = false,
  className,
}: SignedNumberProps) {
  const label = text(value, format, decimals, unit);
  return (
    <span className={cx('vt-num', styles.signed, className)} data-direction={directionOf(value)}>
      {label === MISSING ? <Missing /> : label}
    </span>
  );
}

function Missing() {
  return (
    <>
      <span aria-hidden="true">{MISSING}</span>
      <VisuallyHidden>데이터 없음</VisuallyHidden>
    </>
  );
}

export interface PriceChangeProps {
  /** 전일 대비 변화량(원 또는 달러). */
  change: MaybeNumber;
  /** 등락률(퍼센트 값, 1.71 = 1.71%). */
  percent: MaybeNumber;
  currency: Currency;
  /** 문장 안에서 원화 변화량에 "원"을 붙인다. */
  unit?: boolean;
  className?: string;
}

/** 변화량과 등락률을 한 덩어리로: `+1,200 (+1.71%)`, `−$1.87 (−1.36%)`. */
export function PriceChange({
  change,
  percent,
  currency,
  unit = false,
  className,
}: PriceChangeProps) {
  const changeText =
    currency === 'KRW' ? formatWonChange(change, { unit }) : formatUsdChange(change);
  const percentText = formatPercent(percent);
  return (
    <span
      className={cx('vt-num', styles.signed, className)}
      data-direction={directionOf(change ?? percent)}
    >
      {changeText === MISSING ? <Missing /> : changeText}
      {' ('}
      {percentText === MISSING ? <Missing /> : percentText}
      {')'}
    </span>
  );
}
