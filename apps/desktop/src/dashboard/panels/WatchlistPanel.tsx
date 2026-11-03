import { useStreamStatus } from '../../api/services';
import type { WatchQuote } from '../../api/types';
import { navigate } from '../../app/router';
import { DataTable, SignedNumber, type Column } from '../../design-system';
import { Feed, Price, StockName } from '../../screens/common/quotes';
import { useShared } from '../shared';
import { quotesSource, settingsSource } from '../sources';
import { PanelEmpty, PanelError, styles } from './common';
import { pick, type PanelProps } from './types';

export const WATCH_MARKETS = ['all', 'KR', 'US'] as const;
export const WATCH_MARKET_LABEL: Record<(typeof WATCH_MARKETS)[number], string> = {
  all: '전체',
  KR: '국내',
  US: '미국',
};

function columns(width: number, pollSeconds: number): Column<WatchQuote>[] {
  const cols: Column<WatchQuote>[] = [
    {
      key: 'name',
      header: '종목',
      cell: (r) => <StockName market={r.market} name={r.name} code={r.code} />,
    },
    {
      key: 'price',
      header: '현재가',
      numeric: true,
      cell: (r) => <Price value={r.price} market={r.market} />,
    },
  ];
  // 좁은 칸은 등락률을 남기고 전일 대비·수신을 먼저 뺀다(가로 스크롤 대신)
  if (width >= 460) {
    cols.push({
      key: 'change',
      header: '전일 대비',
      numeric: true,
      cell: (r) => <SignedNumber value={r.change} format={r.market === 'US' ? 'usd' : 'won'} />,
    });
  }
  cols.push({
    key: 'pct',
    header: '등락률',
    numeric: true,
    cell: (r) => <SignedNumber value={r.change_pct} format="percent" />,
  });
  if (width >= 560) {
    cols.push({
      key: 'feed',
      header: '수신',
      width: '8.5rem',
      cell: (r) => <Feed feed={r.feed} pollSeconds={pollSeconds} />,
    });
  }
  return cols;
}

/** 감시 종목: 현재가·등락·수신 상태. 행을 누르면 그 종목의 감시·알림으로 간다. */
export function WatchlistPanel({ options, size }: PanelProps) {
  const market = pick(options, 'market', WATCH_MARKETS, 'all');
  const quotes = useShared(quotesSource);
  const settings = useShared(settingsSource);
  const stale = useStreamStatus() === 'disconnected';
  const poll = settings.data?.['alerts.poll_interval_sec'];

  if (quotes.error) {
    return (
      <PanelError
        error={quotes.error}
        title="감시 종목을 불러오지 못했습니다"
        onRetry={quotes.reload}
      />
    );
  }
  if (!quotes.data) return <div className={styles.body} aria-busy="true" />;
  // SSE가 끊긴 동안은 수신 상태를 모른다: 마지막 상태(실시간 등)를 그대로 두지 않는다
  const rows = quotes.data
    .filter((r) => market === 'all' || r.market === market)
    .map((r) => (stale && r.feed !== 'closed' ? { ...r, feed: 'offline' as const } : r));
  if (rows.length === 0) {
    return (
      <PanelEmpty>
        {market === 'all'
          ? '감시 종목이 없습니다 · '
          : `${WATCH_MARKET_LABEL[market]} 감시 종목이 없습니다 · `}
        <a href="#/alerts">종목 추가</a>
      </PanelEmpty>
    );
  }
  const up = rows.filter((r) => (r.change_pct ?? 0) > 0).length;
  const down = rows.filter((r) => (r.change_pct ?? 0) < 0).length;
  return (
    <div className={styles.body}>
      <DataTable
        caption="감시 종목"
        columns={columns(size.w, typeof poll === 'number' ? poll : 30)}
        rows={rows}
        rowKey={(r) => `${r.market}:${r.code}`}
        onRowActivate={(r) =>
          navigate({ name: 'symbol', market: r.market === 'US' ? 'US' : 'KR', code: r.code })
        }
      />
      <div className={styles.foot}>
        <span className="vt-num">{`${rows.length}종목 · 상승 ${up} · 하락 ${down}`}</span>
        <a href="#/alerts">+ 종목 추가</a>
      </div>
    </div>
  );
}
