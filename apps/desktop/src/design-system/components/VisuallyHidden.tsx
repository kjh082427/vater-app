import type { ReactNode } from 'react';
import styles from './VisuallyHidden.module.css';

/** 화면에는 보이지 않고 화면 읽기 프로그램만 읽는 글자. */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className={styles.hidden}>{children}</span>;
}
