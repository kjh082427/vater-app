import { cx } from '../internal/cx';
import { MISSING } from '../format/money';
import styles from './DivergingBar.module.css';

export interface DivergingBarRow {
  label: string;
  value: number;
}

export interface DivergingBarProps {
  rows: DivergingBarRow[];
  /** 값 라벨 표기. 수급이면 formatEokChange(부호 포함). */
  format: (n: number) => string;
  /** 무엇의 막대인지. 읽기 이름은 이 말 + 행마다 이름·값. */
  'aria-label': string;
  className?: string;
}

type Direction = 'up' | 'down' | 'flat';

function directionOf(value: number): Direction {
  if (!Number.isFinite(value) || value === 0) return 'flat';
  return value > 0 ? 'up' : 'down';
}

/**
 * 0 기준 양방향 가로 막대(수급: 순매수 빨강 오른쪽, 순매도 파랑 왼쪽).
 * 길이는 가장 큰 절댓값이 반쪽 너비. 0은 막대 없이 회색 값, 숫자가 아니면 "—".
 */
export function DivergingBar({
  rows,
  format,
  'aria-label': ariaLabel,
  className,
}: DivergingBarProps) {
  const maxAbs = Math.max(
    0,
    ...rows.map((r) => (Number.isFinite(r.value) ? Math.abs(r.value) : 0)),
  );
  const text = (value: number) => (Number.isFinite(value) ? format(value) : MISSING);
  const summary = `${ariaLabel}: ${rows.map((r) => `${r.label} ${text(r.value)}`).join(', ')}`;
  return (
    <div role="img" aria-label={summary} className={cx(styles.chart, className)}>
      {rows.map((row) => {
        const direction = directionOf(row.value);
        const share = maxAbs > 0 && direction !== 'flat' ? (Math.abs(row.value) / maxAbs) * 50 : 0;
        return (
          <div key={row.label} className={styles.row} data-row={row.label}>
            <span className={styles.label}>{row.label}</span>
            <span className={styles.track}>
              {share > 0 ? (
                <span
                  data-role="bar"
                  className={styles.bar}
                  data-side={direction === 'up' ? 'right' : 'left'}
                  data-direction={direction}
                  style={{ width: `${Math.round(share * 100) / 100}%` }}
                />
              ) : null}
            </span>
            <span
              data-role="value"
              className={cx(styles.value, 'vt-num')}
              data-direction={direction}
            >
              {text(row.value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
