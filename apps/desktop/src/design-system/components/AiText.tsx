import type { ReactNode } from 'react';
import { cx } from '../internal/cx';
import styles from './AiText.module.css';

export interface AiTextProps {
  /** lead: 브리핑 한 문장·요약 첫 줄(16px 반굵게), body: 이어지는 문장과 보고서 본문(14px, 기본). */
  size?: 'lead' | 'body';
  /** 감쌀 요소. 기본은 문단(p). 여러 줄 요약은 div 안에 목록을 넣는다. 늘 블록이다(왼쪽 선). */
  as?: 'p' | 'div' | 'blockquote';
  /** 문장 뒤에 붙는 꼬리표. 예: "AI 해석", "AI 요약". 한 덩어리에 한 번. */
  attribution?: string;
  className?: string;
  children: ReactNode;
}

/**
 * AI가 쓴 문장. 왼쪽 옅은 강조선과 꼬리표로 데이터에서 나온 숫자와 눈으로 구분된다.
 * 한 덩어리(브리핑 해석, 분석 요약)마다 attribution을 한 번 붙인다.
 */
export function AiText({
  size = 'body',
  as: Tag = 'p',
  attribution,
  className,
  children,
}: AiTextProps) {
  return (
    <Tag className={cx(styles.ai, className)} data-voice="ai" data-size={size}>
      {children}
      {attribution ? (
        <>
          {' '}
          <span className={styles.attribution} data-attribution>
            {attribution}
          </span>
        </>
      ) : null}
    </Tag>
  );
}
