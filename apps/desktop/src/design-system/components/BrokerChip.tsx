import type { CSSProperties, ReactNode } from 'react';
import { brokerColor } from '../internal/brokerColor';
import styles from './BrokerChip.module.css';

export interface BrokerChipProps {
  id: string;
  /** 사이드카가 준 증권사 색. 내장 증권사는 토큰 색을 대신 쓴다. */
  color: string;
  /** 이름과 값. 예: "한투 10주". 글자는 늘 잉크색이다. */
  children: ReactNode;
}

/** 증권사 칩: 색 점 + 잉크색 글자. 색은 점에만 쓴다. */
export function BrokerChip({ id, color, children }: BrokerChipProps) {
  return (
    <span className={styles.chip}>
      <i
        data-dot
        aria-hidden="true"
        className={styles.dot}
        style={{ '--broker-color': brokerColor(id, color) } as CSSProperties}
      />
      {children}
    </span>
  );
}
