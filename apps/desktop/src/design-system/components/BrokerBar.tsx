import type { CSSProperties } from 'react';
import { brokerColor } from '../internal/brokerColor';
import { cx } from '../internal/cx';
import styles from './BrokerBar.module.css';

export interface BrokerBarShare {
  id: string;
  name: string;
  color: string;
  /** 0~1. 0이면 칸을 그리지 않는다. */
  ratio: number;
}

export interface BrokerBarProps {
  shares: BrokerBarShare[];
  className?: string;
}

const pct = (r: number) => `${(Math.round(r * 1000) / 10).toFixed(1)}%`;

/** 증권사별 비중 막대. 칸 사이에 흰 틈을 둔다. 읽기 이름에 이름과 비율을 담는다. */
export function BrokerBar({ shares, className }: BrokerBarProps) {
  const cells = shares.filter((s) => s.ratio > 0);
  return (
    <div
      role="img"
      aria-label={`증권사별 비중: ${cells.map((s) => `${s.name} ${pct(s.ratio)}`).join(', ')}`}
      className={cx(styles.bar, className)}
    >
      {cells.map((s) => (
        <span
          key={s.id}
          data-broker={s.id}
          className={styles.cell}
          style={
            { flexGrow: s.ratio, '--broker-color': brokerColor(s.id, s.color) } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
