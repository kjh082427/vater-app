import type { ReactNode } from 'react';
import { cx } from '../internal/cx';
import styles from './Banner.module.css';

export interface BannerProps {
  /**
   * - caution: 오프라인, 끊김, 오류("키를 확인하세요"). 황토색, role="alert".
   * - info: 알려 두는 말. 회색, role="status".
   */
  tone: 'caution' | 'info';
  /** 무슨 일인지 한 줄. 예: "오프라인: 알림 감시 일시 중지". */
  title: ReactNode;
  /** 원인이나 앱이 하고 있는 일. 예: "30초마다 다시 확인합니다." */
  children?: ReactNode;
  /** 해결 방법 버튼. 예: [지금 다시 확인], [설정 열기]. */
  action?: ReactNode;
  className?: string;
}

/** 화면 위 알림 띠. 원인과 해결 방법을 함께 보여 준다(스펙 8장). */
export function Banner({ tone, title, children, action, className }: BannerProps) {
  return (
    <div
      role={tone === 'caution' ? 'alert' : 'status'}
      className={cx(styles.banner, className)}
      data-tone={tone}
    >
      <span className={styles.title}>{title}</span>
      {children ? <span>{children}</span> : null}
      {action ? <span className={styles.action}>{action}</span> : null}
    </div>
  );
}
