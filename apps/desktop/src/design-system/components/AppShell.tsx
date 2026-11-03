import { useId, type ReactNode } from 'react';
import { cx } from '../internal/cx';
import styles from './AppShell.module.css';

export interface AppShellProps {
  /** 왼쪽: SidebarNav. */
  sidebar: ReactNode;
  /** 아래: StatusBar. */
  statusBar: ReactNode;
  /** 본문 위 띠: 오프라인 같은 Banner. */
  banner?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** 앱 창 틀(스펙 9-1): 왼쪽 사이드바 216px, 본문, 하단 상태 표시줄 32px. */
export function AppShell({ sidebar, statusBar, banner, className, children }: AppShellProps) {
  const mainId = useId();
  return (
    <div className={cx(styles.shell, className)}>
      <a className={styles.skip} href={`#${mainId}`}>
        본문으로 건너뛰기
      </a>
      <div className={styles.sidebar}>{sidebar}</div>
      <div className={styles.column}>
        {banner}
        <main id={mainId} tabIndex={-1} className={styles.main}>
          {children}
        </main>
      </div>
      <div className={styles.status}>{statusBar}</div>
    </div>
  );
}
