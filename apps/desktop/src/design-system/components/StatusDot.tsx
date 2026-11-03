import styles from './StatusDot.module.css';

export type DotTone = 'on' | 'off' | 'caution' | 'caution-strong';

/** 상태 점. 늘 글자와 함께 쓰므로 화면 읽기 프로그램은 건너뛴다. */
export function StatusDot({ tone }: { tone: DotTone }) {
  return <span className={styles.dot} data-dot={tone} aria-hidden="true" />;
}
