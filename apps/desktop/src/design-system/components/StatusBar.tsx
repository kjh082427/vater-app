import type { ReactNode } from 'react';
import { cx } from '../internal/cx';
import styles from './StatusBar.module.css';
import { StatusDot, type DotTone } from './StatusDot';

export interface StatusBarProps {
  children: ReactNode;
  className?: string;
}

/** 하단 상태 표시줄(32px): 시장 상태, 한투 연결, AI 엔진, 감시 상태. */
export function StatusBar({ children, className }: StatusBarProps) {
  return (
    <footer aria-label="상태" className={cx(styles.bar, className)}>
      {children}
    </footer>
  );
}

export interface StatusBarItemProps {
  /** 점 모양: on(켜짐), off(꺼짐), caution(폴링 등), caution-strong(끊김). */
  tone?: DotTone;
  /** 굵은 이름. 예: "한투 연결". */
  label?: string;
  /** 이어지는 설명. 예: "실시간 2 · 폴링 1". 자리가 모자라면 말줄임표로 줄인다. */
  detail?: string;
  /** end: 오른쪽 끝으로 민다. */
  align?: 'start' | 'end';
  /** label·detail 대신 직접 넣을 내용(예: MarketState variant="inline"). */
  children?: ReactNode;
}

export function StatusBarItem({
  tone,
  label,
  detail,
  align = 'start',
  children,
}: StatusBarItemProps) {
  return (
    <div className={styles.item} data-item data-align={align}>
      {tone ? <StatusDot tone={tone} /> : null}
      {label ? <span className={styles.label}>{label}</span> : null}
      {label && detail ? ' ' : null}
      {detail ? <span className={cx(styles.detail, 'vt-num')}>{detail}</span> : null}
      {children}
    </div>
  );
}
