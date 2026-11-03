import { cx } from '../internal/cx';
import styles from './MarketState.module.css';
import { StatusDot } from './StatusDot';

export type Market = 'KR' | 'US';
export type MarketStatus = 'open' | 'closed' | 'holiday';

export interface MarketStateProps {
  market: Market;
  status: MarketStatus;
  /** 다음 시각. 예: "15:30 마감", "23:30 개장". */
  detail?: string;
  /** chip: 본문 안의 작은 칩(기본), inline: 상태 표시줄 안. */
  variant?: 'chip' | 'inline';
  className?: string;
}

const MARKET: Record<Market, string> = { KR: '국내', US: '미국' };
const STATUS: Record<MarketStatus, string> = { open: '장중', closed: '마감', holiday: '휴장' };

/** 시장 개장 상태: "국내 장중 15:30 마감". 장중은 채운 점, 마감·휴장은 빈 원. */
export function MarketState({
  market,
  status,
  detail,
  variant = 'chip',
  className,
}: MarketStateProps) {
  return (
    <span className={cx(styles.market, className)} data-variant={variant} data-status={status}>
      <StatusDot tone={status === 'open' ? 'on' : 'off'} />
      <span className={styles.label}>{`${MARKET[market]} ${STATUS[status]}`}</span>
      {detail ? (
        <>
          {' '}
          <span className="vt-num">{detail}</span>
        </>
      ) : null}
    </span>
  );
}
