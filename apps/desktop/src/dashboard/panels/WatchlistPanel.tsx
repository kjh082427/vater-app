import { useStreamStatus } from '../../api/services';
import type { SymbolValue, WatchQuote } from '../../api/types';
import { navigate } from '../../app/router';
import {
  DataTable,
  formatQuantity,
  PriceChange,
  SignedNumber,
  type Column,
} from '../../design-system';
import { Feed, MissingValue, Price, StockName } from '../../screens/common/quotes';
import { useShared } from '../shared';
import { portfolioSummarySource, quotesSource, settingsSource } from '../sources';
import { PanelEmpty, PanelError, styles } from './common';
import { pick, type PanelProps } from './types';

export const WATCH_MARKETS = ['all', 'KR', 'US'] as const;
export const WATCH_MARKET_LABEL: Record<(typeof WATCH_MARKETS)[number], string> = {
  all: '전체',
  KR: '국내',
  US: '미국',
};

/** 보유 열이 있는 표의 한 줄: 감시 종목 + 그 종목의 보유(없으면 undefined). */
type Row = WatchQuote & { held?: SymbolValue };

function columns(width: number, pollSeconds: number, withHoldings: boolean): Column<Row>[] {
  const cols: Column<Row>[] = [
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
  if (withHoldings) {
    // 좁아지면 평단가부터, 다음 보유, 마지막으로 평가손익이 빠진다
    if (width >= 520) {
      cols.push({
        key: 'pl',
        header: '평가손익',
        numeric: true,
        cell: (r) =>
          r.held && r.held.pl !== null ? (
            <PriceChange
              change={r.held.pl}
              percent={r.held.pl_pct}
              currency={r.held.currency === 'USD' ? 'USD' : 'KRW'}
            />
          ) : (
            <MissingValue />
          ),
      });
    }
    if (width >= 600) {
      cols.push({
        key: 'qty',
        header: '보유',
        numeric: true,
        cell: (r) => (r.held ? `${formatQuantity(r.held.total, r.market)}주` : <MissingValue />),
      });
    }
    if (width >= 700) {
      cols.push({
        key: 'avg',
        header: '평단가',
        numeric: true,
        cell: (r) =>
          r.held ? <Price value={r.held.avg_price} market={r.market} /> : <MissingValue />,
      });
    }
  }
  return cols;
}

/** 감시 종목: 현재가·등락·수신 상태. 행을 누르면 그 종목의 감시·알림으로 간다. */
export function WatchlistPanel({ options, size }: PanelProps) {
  const market = pick(options, 'market', WATCH_MARKETS, 'all');
  const quotes = useShared(quotesSource);
  const settings = useShared(settingsSource);
  const portfolio = useShared(portfolioSummarySource);
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
    .map((r): Row => (stale && r.feed !== 'closed' ? { ...r, feed: 'offline' as const } : r))
    .map((r) => ({
      ...r,
      held: portfolio.data?.symbols.find((s) => s.market === r.market && s.code === r.code),
    }));
  // 보유 내역이 하나도 없으면 보유 열을 더하지 않는다(빈 열 세 개가 표를 좁히지 않게)
  const withHoldings = (portfolio.data?.symbols.length ?? 0) > 0;
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
        columns={columns(size.w, typeof poll === 'number' ? poll : 30, withHoldings)}
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
