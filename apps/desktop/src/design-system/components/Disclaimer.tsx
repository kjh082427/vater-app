import type { ReactNode } from 'react';
import { cx } from '../internal/cx';
import styles from './Disclaimer.module.css';

export const DISCLAIMER_BASE = '투자 판단 보조용이며 투자 권유가 아닙니다.';
export const DISCLAIMER_ANALYSIS = '모델과 실행에 따라 결론이 달라질 수 있습니다.';

export interface DisclaimerProps {
  /** 분석 결과 화면: "모델과 실행에 따라 결론이 달라질 수 있습니다."를 덧붙인다. */
  analysis?: boolean;
  /** 뒤에 이어 쓸 문장. 예: "Vater는 주문 기능이 없습니다." */
  children?: ReactNode;
  className?: string;
}

/** 면책 문구. 결과 화면마다 둔다(스펙 9-1). 문구는 스펙 그대로이며 바꾸지 않는다. */
export function Disclaimer({ analysis = false, children, className }: DisclaimerProps) {
  return (
    <p className={cx(styles.disclaimer, className)}>
      {DISCLAIMER_BASE}
      {analysis ? ` ${DISCLAIMER_ANALYSIS}` : null}
      {children ? <> {children}</> : null}
    </p>
  );
}
