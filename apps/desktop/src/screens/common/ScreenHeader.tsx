import type { ReactNode } from 'react';
import styles from './screen.module.css';

export interface ScreenHeaderProps {
  title: string;
  /** 제목 아래 한 줄 설명. */
  lede?: ReactNode;
  /** 오른쪽 끝: 기준 시각, 주 버튼(한 화면에 하나). */
  end?: ReactNode;
}

/** 화면 머리: 화면 제목(h1)은 화면마다 하나. */
export function ScreenHeader({ title, lede, end }: ScreenHeaderProps) {
  return (
    <header className={styles.header}>
      <div>
        <h1 className={styles.title}>{title}</h1>
        {lede ? <p className={styles.lede}>{lede}</p> : null}
      </div>
      {end ? <div className={styles.headerEnd}>{end}</div> : null}
    </header>
  );
}
