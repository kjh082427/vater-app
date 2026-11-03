import { cx } from '../internal/cx';
import styles from './ProgressBar.module.css';

export interface ProgressBarProps {
  /** 0~100. 범위를 벗어나면 맞추고, 숫자가 아니면 0. */
  value: number;
  label: string;
  className?: string;
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(100, Math.max(0, value)));
}

/** 진행 막대(진행 중인 분석). 6px 높이, 채움은 강조색. */
export function ProgressBar({ value, label, className }: ProgressBarProps) {
  const now = clamp(value);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={now}
      className={cx(styles.bar, className)}
    >
      <span className={styles.fill} style={{ width: `${now}%` }} />
    </div>
  );
}
