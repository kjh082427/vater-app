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

/** 구역: 칸 카드 모양(제목, 설명 한 줄, 행동) + 본문. 안쪽 구역(3·4단계)은 카드가 아니라 선으로 나눈다. */
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
    <section
      aria-labelledby={headingId}
      className={cx(styles.section, className)}
      data-level={headingLevel}
    >
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
