import { useId, useRef, type MouseEvent, type ReactNode } from 'react';
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

/** 앱 창 틀(스펙 9-1): 왼쪽 사이드바 200px, 캔버스 바탕의 본문, 하단 상태 표시줄 28px. */
export function AppShell({ sidebar, statusBar, banner, className, children }: AppShellProps) {
  const mainId = useId();
  const mainRef = useRef<HTMLElement>(null);

  // 주소의 #을 바꾸지 않는다: 화면이 해시 라우터를 써도 부딪히지 않게 포커스만 옮긴다.
  function skipToMain(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    mainRef.current?.focus();
  }

  return (
    <div className={cx(styles.shell, className)}>
      <a className={styles.skip} href={`#${mainId}`} onClick={skipToMain}>
        본문으로 건너뛰기
      </a>
      <div className={styles.sidebar}>{sidebar}</div>
      <div className={styles.column}>
        {banner}
        <main ref={mainRef} id={mainId} tabIndex={-1} className={styles.main}>
          {children}
        </main>
      </div>
      <div className={styles.status}>{statusBar}</div>
    </div>
  );
}
