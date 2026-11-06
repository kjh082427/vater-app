import type { ReactNode } from 'react';
import { cx } from '../internal/cx';
import styles from './Icon.module.css';

/*
 * 직접 그린 아이콘(24 격자, 선 1.5, 둥근 끝). 늘 장식이라 aria-hidden이다.
 * 아이콘만 있는 버튼은 Button variant="icon" + aria-label로만 만든다(칸 머리의 ⋯, 닫기).
 */
const PATHS = {
  home: <path d="M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z" />,
  analysis: (
    <>
      <path d="M6 3h8.5L19 7.5V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5M8.5 12.5h7M8.5 16.5h4.5" />
    </>
  ),
  holdings: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5V12h8.5" />
    </>
  ),
  alerts: (
    <>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
  briefing: (
    <>
      <path d="M4 5h12.5v13.5a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2z" />
      <path d="M16.5 9H20v9.5a2 2 0 0 1-2 2M7.5 9h5.5M7.5 13h5.5M7.5 17h3.5" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h8M17 7h3M4 17h3M12 17h8" />
      <circle cx="14.5" cy="7" r="2.5" />
      <circle cx="9.5" cy="17" r="2.5" />
    </>
  ),
  pause: <path d="M9 6v12M15 6v12" />,
  play: <path d="M8 5.5v13l10.5-6.5z" />,
  refresh: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 4.5v4h-4" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.25" fill="currentColor" />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.25" fill="currentColor" />
    </>
  ),
  grip: (
    <>
      <circle cx="9" cy="6" r="1.25" fill="currentColor" />
      <circle cx="15" cy="6" r="1.25" fill="currentColor" />
      <circle cx="9" cy="12" r="1.25" fill="currentColor" />
      <circle cx="15" cy="12" r="1.25" fill="currentColor" />
      <circle cx="9" cy="18" r="1.25" fill="currentColor" />
      <circle cx="15" cy="18" r="1.25" fill="currentColor" />
    </>
  ),
  'chevron-down': <path d="m7 10 5 5 5-5" />,
  check: <path d="m5.5 12.5 4 4 9-9" />,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export interface IconProps {
  name: IconName;
  /** md 18px(사이드바), sm 14px(버튼 안). */
  size?: 'md' | 'sm';
  className?: string;
}

export function Icon({ name, size = 'md', className }: IconProps) {
  return (
    <svg
      className={cx(styles.icon, className)}
      data-size={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
