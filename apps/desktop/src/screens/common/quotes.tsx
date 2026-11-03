/** 시세 칸 조합: 가격(값 없음 포함), 종목 이름, 수신 상태. 숫자는 design-system 표기 함수만 쓴다. */
import type { FeedKind } from '../../api/types';
import {
  FeedStatus,
  formatPrice,
  MISSING,
  StatusDot,
  VisuallyHidden,
  type Currency,
} from '../../design-system';
import styles from './screen.module.css';

export const currencyOf = (market: string): Currency => (market === 'US' ? 'USD' : 'KRW');
export const marketLabel = (market: string) => (market === 'US' ? '미국' : '국내');

/** 값 없음: 화면에는 `—`, 화면 읽기 프로그램에는 "데이터 없음". */
export function MissingValue() {
  return (
    <>
      <span aria-hidden="true">{MISSING}</span>
      <VisuallyHidden>데이터 없음</VisuallyHidden>
    </>
  );
}

/** 가격: `71,400원`, `$227.48`, 없으면 `—`. */
export function Price({ value, market }: { value: number | null | undefined; market: string }) {
  return typeof value === 'number' && Number.isFinite(value) ? (
    <>{formatPrice(value, currencyOf(market))}</>
  ) : (
    <MissingValue />
  );
}

/** 종목: 시장 · 이름 · 코드. */
export function StockName({ market, name, code }: { market: string; name: string; code: string }) {
  return (
    <span className={styles.stock}>
      <span className={styles.stockMeta}>{marketLabel(market)}</span>
      <b>{name}</b>
      <span className={`${styles.stockMeta} vt-num`}>{code}</span>
    </span>
  );
}

/**
 * 시세 수신 상태. 사이드카 feed → FeedStatus. `idle`(장중이지만 실시간 규칙이 없어 감시하지 않는 종목)은
 * FeedStatus에 없는 상태라 같은 모양(빈 점 + 글자)으로 따로 쓴다.
 */
export function Feed({ feed, pollSeconds }: { feed: FeedKind; pollSeconds?: number }) {
  switch (feed) {
    case 'realtime':
      return <FeedStatus state="live" />;
    case 'polling':
      return <FeedStatus state="polling" intervalSeconds={pollSeconds} />;
    case 'offline':
      return <FeedStatus state="disconnected" />;
    case 'closed':
      return <FeedStatus state="closed" />;
    case 'idle':
      return (
        <span className={styles.feedIdle}>
          <StatusDot tone="off" />
          실시간 규칙 없음
        </span>
      );
  }
}
