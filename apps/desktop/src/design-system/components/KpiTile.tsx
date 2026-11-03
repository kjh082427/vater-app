import type { ReactNode } from 'react';
import { cx } from '../internal/cx';
import styles from './KpiTile.module.css';

export interface KpiTileProps {
  /** 작은 이름표. 묶음의 이름이 된다. */
  label: string;
  /** 큰 숫자(28px). format/money.ts로 꾸민 글자나, 숫자 + 단위 같은 노드. */
  value: ReactNode;
  /** 숫자 아래 줄: 보통 PriceChange, 또는 "상승 2 · 하락 1" 같은 보조 정보. */
  change?: ReactNode;
  /** 오른쪽 아래 미니 차트(Sparkline 등)나 진행 막대. 좁으면 먼저 숨는다. */
  chart?: ReactNode;
  /** 이름표 앞의 분류 표지. 중립색 네모 하나만 있다(빨강·파랑으로 분류하지 않는다). */
  tag?: 'neutral';
  className?: string;
}

/** 숫자 카드(맨 위 숫자 줄, kpi 칸): 이름표 → 큰 숫자 → 변화 + 오른쪽 미니 차트. */
export function KpiTile({ label, value, change, chart, tag, className }: KpiTileProps) {
  return (
    <div role="group" aria-label={label} className={cx(styles.tile, className)}>
      <div className={styles.label}>
        {tag ? <span className={styles.tag} data-tag={tag} aria-hidden="true" /> : null}
        <span className={styles.labelText}>{label}</span>
      </div>
      <div className={cx(styles.value, 'vt-num')}>{value}</div>
      {change ? <div className={cx(styles.change, 'vt-num')}>{change}</div> : null}
      {chart ? <div className={styles.chart}>{chart}</div> : null}
    </div>
  );
}
