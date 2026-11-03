import type { ApiError } from '../api/errors';
import type { CheckOut, MarketCode, MonitorStatus } from '../api/types';
import { MarketState, StatusBar, StatusBarItem } from '../design-system';
import { formatClock } from '../screens/common/time';
import { engineSummary, feedSummary, marketDetail } from './status';

export interface AppStatusBarProps {
  monitor: MonitorStatus | undefined;
  llm: CheckOut | undefined;
  llmError: ApiError | null;
  analyses: { running: number; queued: number };
  lastEventAt: Date | null;
}

const MARKETS: MarketCode[] = ['KR', 'US'];

/** 하단 상태 표시줄(스펙 9-1): 시장 상태, 한투 연결, AI 엔진, 마지막 수신 시각. */
export function AppStatusBar({ monitor, llm, llmError, analyses, lastEventAt }: AppStatusBarProps) {
  const feed = feedSummary(monitor);
  const engine = engineSummary(llm, llmError, analyses);
  return (
    <StatusBar>
      {MARKETS.map((market) => {
        const status = monitor?.markets[market];
        return status ? (
          <StatusBarItem key={market}>
            <MarketState
              market={market}
              status={status === 'open' ? 'open' : 'closed'}
              detail={marketDetail(market, status)}
              variant="inline"
            />
          </StatusBarItem>
        ) : null;
      })}
      <StatusBarItem tone={feed.tone} label="한투 연결" detail={feed.detail} />
      <StatusBarItem tone={engine.tone} label="AI 엔진" detail={engine.detail} />
      {lastEventAt ? (
        <StatusBarItem align="end" detail={`마지막 수신 ${formatClock(lastEventAt)}`} />
      ) : null}
    </StatusBar>
  );
}
