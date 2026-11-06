import { navigate } from '../../app/router';
import type { SymbolValue } from '../../api/types';
import {
  DataTable,
  formatQuantity,
  formatPrice,
  PriceChange,
  type Column,
  type Currency,
} from '../../design-system';
import { MissingValue, Price, StockName } from '../../screens/common/quotes';
import { useShared } from '../shared';
import { portfolioSummarySource } from '../sources';
import { hasUnpriced, PanelEmpty, PanelError, styles, UNPRICED_NOTE } from './common';
import type { PanelProps } from './types';

const currencyOf = (s: SymbolValue): Currency => (s.currency === 'USD' ? 'USD' : 'KRW');

function columns(width: number): Column<SymbolValue>[] {
  const cols: Column<SymbolValue>[] = [
    {
      key: 'name',
      header: '종목',
      truncate: true,
      cell: (r) => <StockName market={r.market} name={r.name} code={r.code} />,
    },
  ];
  if (width >= 460) {
    cols.push({
      key: 'qty',
      header: '보유',
      numeric: true,
      cell: (r) => `${formatQuantity(r.total, r.market)}주`,
    });
  }
  if (width >= 620) {
    cols.push({
      key: 'avg',
      header: '평단가',
      numeric: true,
      cell: (r) => <Price value={r.avg_price} market={r.market} />,
    });
  }
  cols.push(
    {
      key: 'value',
      header: '평가금액',
      numeric: true,
      cell: (r) =>
        r.value === null ? <MissingValue /> : <>{formatPrice(r.value, currencyOf(r))}</>,
    },
    {
      key: 'pl',
      header: '평가손익',
      numeric: true,
      cell: (r) =>
        r.pl === null ? (
          <MissingValue />
        ) : (
          <PriceChange change={r.pl} percent={r.pl_pct} currency={currencyOf(r)} />
        ),
    },
  );
  return cols;
}

/** 내 보유 종목: 종목별 보유 수량·평단가·평가금액·평가손익(스펙 4-2). 시세가 없는 종목은 합계에서 뺀다. */
export function HoldingsPanel({ size }: PanelProps) {
  const summary = useShared(portfolioSummarySource);
  if (summary.error) {
    return (
      <PanelError
        error={summary.error}
        title="보유 현황을 불러오지 못했습니다"
        onRetry={summary.reload}
      />
    );
  }
  if (!summary.data) return <div className={styles.body} aria-busy="true" />;
  const { symbols, missing_prices: missing, unsupported } = summary.data;
  if (symbols.length === 0 && unsupported > 0) {
    return <PanelEmpty>{`지원하지 않는 ${unsupported}종목만 있어 평가하지 않습니다`}</PanelEmpty>;
  }
  if (symbols.length === 0) {
    return (
      <PanelEmpty>
        보유 내역이 없습니다 · <a href="#/settings">증권사 연결</a> 또는{' '}
        <a href="#/holdings">보유 내역 직접 입력</a>
      </PanelEmpty>
    );
  }
  return (
    <div className={styles.body}>
      <DataTable
        caption="내 보유 종목"
        columns={columns(size.w)}
        rows={symbols}
        rowKey={(r) => `${r.market}:${r.code}`}
        onRowActivate={(r) =>
          navigate({ name: 'symbol', market: r.market === 'US' ? 'US' : 'KR', code: r.code })
        }
      />
      <div className={styles.foot}>
        <span className="vt-num">{`${symbols.length}종목`}</span>
        {missing > 0 ? <span>{`시세를 받지 못한 ${missing}종목은 합계에서 뺐습니다`}</span> : null}
        {unsupported > 0 ? (
          <span>{`지원하지 않는 ${unsupported}종목은 평가하지 않습니다`}</span>
        ) : null}
        {hasUnpriced(symbols) ? <span>{UNPRICED_NOTE}</span> : null}
      </div>
    </div>
  );
}
