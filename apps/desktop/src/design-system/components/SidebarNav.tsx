import type { MouseEvent, ReactNode } from 'react';
import { cx } from '../internal/cx';
import { Icon, type IconName } from './Icon';
import styles from './SidebarNav.module.css';
import { VisuallyHidden } from './VisuallyHidden';

export interface NavItem {
  id: string;
  label: string;
  icon: IconName;
  href: string;
  /** 새 소식 수. text는 화면에 보이는 말("새 2"), label은 읽어 주는 말("새 알림 2건"). */
  badge?: { text: string; label: string };
}

export interface SidebarNavProps {
  items: NavItem[];
  currentId: string;
  /** 있으면 링크 이동 대신 부른다(앱 안 라우팅). 새 창 열기(Ctrl·가운데 클릭)는 막지 않는다. */
  onNavigate?: (id: string) => void;
  /** 아래쪽 자리: 감시 상태, 일시 중지 버튼, 연결 서버. */
  footer?: ReactNode;
  className?: string;
}

/** 왼쪽 사이드바: 워드마크, 주 메뉴, 아래쪽 상태. 크롬 바탕에 색을 쓰지 않는다. */
export function SidebarNav({ items, currentId, onNavigate, footer, className }: SidebarNavProps) {
  function onClick(event: MouseEvent<HTMLAnchorElement>, id: string) {
    if (!onNavigate || event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    onNavigate(id);
  }

  return (
    <aside className={cx(styles.side, className)}>
      <div className={styles.brand}>
        <span className={styles.wordmark}>Vater</span>
        <span className={styles.tagline}>투자 보조</span>
      </div>
      <nav aria-label="주 메뉴">
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.id}>
              <a
                className={styles.link}
                href={item.href}
                aria-current={item.id === currentId ? 'page' : undefined}
                onClick={(event) => onClick(event, item.id)}
              >
                <Icon name={item.icon} />
                {item.label}
                {item.badge ? (
                  <>
                    <span className={styles.badge} aria-hidden="true">
                      {item.badge.text}
                    </span>
                    <VisuallyHidden>{`, ${item.badge.label}`}</VisuallyHidden>
                  </>
                ) : null}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {footer ? <div className={styles.foot}>{footer}</div> : null}
    </aside>
  );
}
