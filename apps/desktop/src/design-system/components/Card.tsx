import { useId, type ReactNode } from 'react';
import { cx } from '../internal/cx';
import styles from './Card.module.css';

export interface CardProps {
  title: ReactNode;
  /** 제목 아래 설명 한 줄. 넘치면 말줄임표. */
  description?: ReactNode;
  /** 머리 오른쪽: 보통 `⋯` Menu. 줄어들지 않는다. */
  actions?: ReactNode;
  /** false면 본문에 여백이 없다(표나 차트를 카드 끝까지). 머리의 여백은 그대로. */
  padded?: boolean;
  /** 이름을 제목과 다르게 줄 때(예: "칸 1: 지수 차트"). 없으면 제목이 이름이다. */
  'aria-label'?: string;
  className?: string;
  children: ReactNode;
}

/**
 * 칸 카드(스펙 2026-11-03 5장): 흰 바탕, 모서리 8px, 옅은 그림자, 안쪽 16px.
 * 머리 = 제목(h2 16px) + 설명 한 줄(13px) + 오른쪽 행동. 카드 안에 카드를 넣지 않는다.
 */
export function Card({
  title,
  description,
  actions,
  padded = true,
  'aria-label': ariaLabel,
  className,
  children,
}: CardProps) {
  const titleId = useId();
  return (
    <section
      className={cx(styles.card, className)}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel ? undefined : titleId}
    >
      <div className={styles.head}>
        <div className={styles.titles}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          {description ? <p className={styles.description}>{description}</p> : null}
        </div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
      <div className={styles.body} data-padded={padded ? 'true' : 'false'}>
        {children}
      </div>
    </section>
  );
}
