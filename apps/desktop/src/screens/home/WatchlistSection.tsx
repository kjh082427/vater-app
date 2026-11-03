import { useEffect } from 'react';
import { useEvent } from '../../api/services';
import { useResource } from '../../api/useResource';
import type { WatchQuote } from '../../api/types';
import { Button, DataTable, Section, SignedNumber, type Column } from '../../design-system';
import { navigate } from '../../app/router';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import { Feed, Price, StockName } from '../common/quotes';
import common from '../common/screen.module.css';

/** 장중이지만 실시간 규칙이 없는(idle) 종목은 SSE 시세가 오지 않아 이 간격으로 다시 받는다. */
const IDLE_REFRESH_MS = 30_000;

function columns(pollSeconds: number | undefined): Column<WatchQuote>[] {
  return [
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
    {
      // 표 안 변화량은 단위를 뺀다(국내 +1,200). 미국 종목은 $가 붙는다(+$2.13).
      key: 'change',
      header: '전일 대비',
      numeric: true,
      cell: (r) => <SignedNumber value={r.change} format={r.market === 'US' ? 'usd' : 'won'} />,
    },
    {
      key: 'pct',
      header: '등락률',
      numeric: true,
      cell: (r) => <SignedNumber value={r.change_pct} format="percent" />,
    },
    {
      key: 'feed',
      header: <span className={common.afterNumeric}>수신</span>,
      width: '9rem',
      cell: (r) => (
        <span className={common.afterNumeric}>
          <Feed feed={r.feed} pollSeconds={pollSeconds} />
        </span>
      ),
    },
  ];
}

/** 감시 종목: GET /watchlist/quotes + SSE quote(시세)·alerts.state(수신 상태). */
export function WatchlistSection({ settings }: { settings?: Record<string, unknown> }) {
  const quotes = useResource<WatchQuote[]>('/watchlist/quotes');
  const { mutate, reload } = quotes;

  useEvent('quote', (q) =>
    mutate((rows) =>
      rows?.map((r) =>
        r.market === q.market && r.code === q.code
          ? {
              ...r,
              price: q.price,
              change: q.change,
              change_pct: q.change_pct,
              at: q.at,
              source: q.source,
            }
          : r,
      ),
    ),
  );
  useEvent('alerts.state', (status) =>
    mutate((rows) =>
      rows?.map((r) => {
        const f = status.feeds.find((x) => x.market === r.market && x.code === r.code);
        return f ? { ...r, feed: f.feed } : r;
      }),
    ),
  );

  const hasIdle = quotes.data?.some((r) => r.feed === 'idle') ?? false;
  useEffect(() => {
    if (!hasIdle) return;
    const timer = setInterval(reload, IDLE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [hasIdle, reload]);

  const poll = settings?.['alerts.poll_interval_sec'];
  const rows = quotes.data;
  return (
    <Section
      title="감시 종목"
      meta={rows && rows.length > 0 ? `${rows.length}종목` : undefined}
      actions={
        <Button variant="quiet" onClick={() => navigate({ name: 'alerts' })}>
          종목 추가
        </Button>
      }
    >
      {quotes.error ? (
        <ApiErrorNotice
          error={quotes.error}
          title="감시 종목을 불러오지 못했습니다"
          onRetry={reload}
        />
      ) : null}
      {rows && rows.length === 0 ? (
        // 빈 표 대신 한 줄: 열 머리만 남은 표는 할 일을 가린다
        <p className={common.empty}>아직 감시 종목이 없습니다. 종목 추가를 눌러 시작하세요.</p>
      ) : null}
      {rows && rows.length > 0 ? (
        <DataTable
          caption="감시 종목"
          columns={columns(typeof poll === 'number' ? poll : 30)}
          rows={rows}
          rowKey={(r) => `${r.market}:${r.code}`}
          onRowActivate={(r) =>
            navigate({ name: 'symbol', market: r.market === 'US' ? 'US' : 'KR', code: r.code })
          }
        />
      ) : null}
    </Section>
  );
}
