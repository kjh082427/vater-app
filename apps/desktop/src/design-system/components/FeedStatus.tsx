import { cx } from '../internal/cx';
import styles from './FeedStatus.module.css';
import { StatusDot, type DotTone } from './StatusDot';

export type FeedState = 'live' | 'polling' | 'disconnected' | 'closed';

export interface FeedStatusProps {
  /** 실시간(WebSocket) / 폴링 / 끊김(재연결 중) / 장 마감. */
  state: FeedState;
  /** 폴링 간격(초). 스펙 기본값은 30초. */
  intervalSeconds?: number;
  className?: string;
}

const DOT: Record<FeedState, DotTone> = {
  live: 'on',
  polling: 'caution',
  disconnected: 'caution-strong',
  closed: 'off',
};

function label(state: FeedState, intervalSeconds?: number): string {
  switch (state) {
    case 'live':
      return '실시간';
    case 'polling':
      return intervalSeconds ? `폴링 · ${intervalSeconds}초` : '폴링';
    case 'disconnected':
      return '끊김 · 재연결 중';
    case 'closed':
      return '장 마감';
  }
}

/** 종목 하나의 시세 수신 상태. 점 모양과 글자로 말하고, 빨강·파랑은 쓰지 않는다. */
export function FeedStatus({ state, intervalSeconds, className }: FeedStatusProps) {
  return (
    <span className={cx(styles.feed, className)} data-state={state}>
      <StatusDot tone={DOT[state]} />
      {label(state, intervalSeconds)}
    </span>
  );
}
