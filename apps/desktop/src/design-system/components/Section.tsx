import { useId, type ReactNode } from 'react';
import { cx } from '../internal/cx';
import styles from './Section.module.css';

export interface SectionProps {
  title: ReactNode;
  /** 제목 옆 보조 정보. 예: "5종목", "11월 2일(월) 국내 마감 · 16:00". */
  meta?: ReactNode;
  /** 머리 오른쪽 끝의 행동. 조용한 버튼이나 세그먼트 탭. */
  actions?: ReactNode;
  /** 제목 단계. 화면 제목(h1) 아래 구역은 2(기본). */
  headingLevel?: 2 | 3 | 4;
  className?: string;
  children: ReactNode;
}

/** 구역: 위쪽 2px 먹선 + 머리(제목, 보조 정보, 행동) + 본문. 카드 상자를 쓰지 않는다. */
export function Section({
  title,
  meta,
  actions,
  headingLevel = 2,
  className,
  children,
}: SectionProps) {
  const headingId = useId();
  const Heading = `h${headingLevel}` as const;
  return (
    <section aria-labelledby={headingId} className={cx(styles.section, className)}>
      <div className={styles.head}>
        <Heading id={headingId} className={styles.title}>
          {title}
        </Heading>
        {meta ? <span className={styles.meta}>{meta}</span> : null}
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
