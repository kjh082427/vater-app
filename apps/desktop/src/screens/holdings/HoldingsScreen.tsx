import { useState } from 'react';
import { useResource } from '../../api/useResource';
import type {
  AlertKindInfo,
  BrokerOut,
  ConnectionOut,
  HoldingOut,
  PortfolioSummary,
  SymbolValue,
  WatchItem,
  WatchQuote,
  WatchResult,
} from '../../api/types';
import {
  BrokerChip,
  Button,
  Card,
  DataTable,
  formatPrice,
  formatQuantity,
  PriceChange,
  type Column,
} from '../../design-system';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import { currencyOf, MissingValue, Price, StockName } from '../common/quotes';
import { ScreenHeader } from '../common/ScreenHeader';
import common from '../common/screen.module.css';
import { symbolKey } from '../common/SymbolSearch';
import styles from './holdings.module.css';
import { ManualDialog } from './ManualForm';
import { UploadButtons, UploadDialog } from './UploadDialog';

interface Row extends SymbolValue {
  /** 증권사별 수량(수량이 많은 곳부터). */
  shares: { broker_id: string; name: string; color: string; quantity: string }[];
  /** 전일 대비(감시 중인 종목만 시세가 있다). */
  quote: WatchQuote | undefined;
}

/** 같은 종목의 증권사별 수량을 합친다. 증권사 이름·색은 증권사 목록에서 가져온다. */
function sharesOf(holdings: HoldingOut[], brokers: BrokerOut[], v: SymbolValue): Row['shares'] {
  const byBroker = new Map<string, number>();
  for (const h of holdings) {
    if (h.market === v.market && h.code === v.code) {
      byBroker.set(h.broker_id, (byBroker.get(h.broker_id) ?? 0) + Number(h.quantity));
    }
  }
  return [...byBroker]
    .map(([id, quantity]) => {
      const b = brokers.find((x) => x.id === id);
      return {
        broker_id: id,
        name: b?.name ?? id,
        color: b?.color ?? '#7f8698',
        quantity: String(quantity),
      };
    })
    .sort((a, b) => Number(b.quantity) - Number(a.quantity));
}

const columns: Column<Row>[] = [
  {
    key: 'name',
    header: '종목',
    truncate: true,
    cell: (r) => <StockName market={r.market} name={r.name} code={r.code} />,
  },
  {
    key: 'price',
    header: '현재가',
    numeric: true,
    cell: (r) => <Price value={r.price} market={r.market} />,
  },
  {
    key: 'change',
    header: '등락',
    numeric: true,
    cell: (r) =>
      r.quote?.change !== null && r.quote?.change !== undefined ? (
        <PriceChange
          change={r.quote.change}
          percent={r.quote.change_pct}
          currency={currencyOf(r.market)}
        />
      ) : (
        <MissingValue />
      ),
  },
  {
    key: 'value',
    header: '평가금액',
    numeric: true,
    cell: (r) =>
      r.value === null ? <MissingValue /> : <>{formatPrice(r.value, currencyOf(r.market))}</>,
  },
  {
    key: 'pl',
    header: '평가손익',
    numeric: true,
    cell: (r) =>
      r.pl === null ? (
        <MissingValue />
      ) : (
        <PriceChange change={r.pl} percent={r.pl_pct} currency={currencyOf(r.market)} unit />
      ),
  },
  {
    key: 'brokers',
    header: '증권사별 수량',
    cell: (r) => (
      <span className={styles.chips}>
        {r.shares.map((s) => (
          <BrokerChip key={s.broker_id} id={s.broker_id} color={s.color}>
            {`${s.name} ${formatQuantity(s.quantity, r.market)}주`}
          </BrokerChip>
        ))}
      </span>
    ),
  },
];

/**
 * 보유 종목(v0.2.1 21장 2번): 보유 내역을 보고(현재가·등락·평가금액·평가손익·증권사별 수량), 올리고(증권사 업로드),
 * 직접 넣고, CSV로 가져오는 곳. 보유 값은 이 화면 밖으로(특히 AI로) 나가지 않는다.
 */
export function HoldingsScreen() {
  const brokers = useResource<BrokerOut[]>('/brokers');
  const connections = useResource<ConnectionOut[]>('/connections');
  const holdings = useResource<HoldingOut[]>('/holdings');
  const summary = useResource<PortfolioSummary>('/portfolio/summary');
  const quotes = useResource<WatchQuote[]>('/watchlist/quotes');
  const watch = useResource<WatchItem[]>('/watchlist');
  const kinds = useResource<AlertKindInfo[]>('/alerts/kinds');
  // 업로드 확인 창: brokerId null은 연결한 증권사 모두
  const [uploading, setUploading] = useState<{ brokerId: string | null } | null>(null);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [manual, setManual] = useState(false);

  const watchedKeys = new Set((watch.data ?? []).map(symbolKey));
  const quoteOf = new Map((quotes.data ?? []).map((q) => [symbolKey(q), q]));
  const rows: Row[] = (summary.data?.symbols ?? []).map((v) => ({
    ...v,
    shares: sharesOf(holdings.data ?? [], brokers.data ?? [], v),
    quote: quoteOf.get(symbolKey(v)),
  }));
  const unsupported = summary.data?.unsupported ?? 0;
  const missing = summary.data?.missing_prices ?? 0;

  function reloadHoldings() {
    holdings.reload();
    summary.reload();
  }

  function uploadDone(result: WatchResult) {
    setUploading(null);
    setUploaded(
      result.added === 0 && result.skipped === 0
        ? '확인했습니다. 감시 종목에는 올리지 않았습니다.'
        : `${result.added}종목을 감시 종목에 올렸습니다.${result.skipped > 0 ? ` ${result.skipped}종목은 이미 있거나 찾지 못해 건너뛰었습니다.` : ''}${result.rules > 0 ? ` 알림 규칙 ${result.rules}개를 만들었습니다.` : ''}`,
    );
    watch.reload();
    reloadHoldings();
  }

  return (
    <>
      <ScreenHeader
        title="보유 종목"
        lede="증권사에서 불러오거나 직접 넣은 보유 내역입니다. 수량과 평단가는 이 PC에만 있고 AI로 보내지 않습니다."
      />
      <div className={common.stack}>
        <Card
          title="보유 내역 올리기"
          description="증권사에서 불러오거나, 직접 입력하거나, 파일(CSV)로 가져옵니다."
        >
          <UploadButtons
            brokers={brokers.data ?? []}
            connections={connections.data ?? []}
            holdings={holdings.data ?? []}
            watchedKeys={watchedKeys}
            ready={Boolean(brokers.data && connections.data && holdings.data)}
            onOpen={(brokerId) => {
              setUploaded(null);
              setUploading({ brokerId });
            }}
          >
            <Button onClick={() => setManual(true)}>보유 내역 직접 입력</Button>
          </UploadButtons>
          {uploaded ? (
            <p role="status" className={common.meta}>
              {uploaded}
            </p>
          ) : null}
        </Card>
        <Card title="보유 종목" description={rows.length > 0 ? `${rows.length}종목` : undefined}>
          {summary.error ? (
            <ApiErrorNotice
              error={summary.error}
              title="보유 현황을 불러오지 못했습니다"
              onRetry={summary.reload}
            />
          ) : null}
          {summary.data && rows.length === 0 ? (
            <p className={common.empty}>
              {unsupported > 0
                ? `지원하지 않는 ${unsupported}종목만 있어 평가하지 않습니다.`
                : '보유 내역이 없습니다. 증권사를 연결하거나 직접 입력해 보세요.'}
            </p>
          ) : null}
          {rows.length > 0 ? (
            <>
              <DataTable caption="보유 종목" columns={columns} rows={rows} rowKey={symbolKey} />
              <p className={common.meta}>
                등락은 감시 중인 종목만 보입니다(전일 대비).
                {missing > 0 ? ` 시세를 받지 못한 ${missing}종목은 평가에서 뺐습니다.` : ''}
                {unsupported > 0 ? ` 지원하지 않는 ${unsupported}종목은 평가하지 않습니다.` : ''}
              </p>
            </>
          ) : null}
        </Card>
        {uploading ? (
          <UploadDialog
            brokerId={uploading.brokerId}
            brokers={brokers.data ?? []}
            kinds={kinds.data}
            onClose={() => setUploading(null)}
            onUploaded={uploadDone}
          />
        ) : null}
        {manual ? (
          <ManualDialog
            onClose={() => setManual(false)}
            onChanged={() => {
              reloadHoldings();
              connections.reload();
              watch.reload();
            }}
            onCsvDone={(brokerId) => {
              setManual(false);
              reloadHoldings();
              brokers.reload();
              setUploaded(null);
              setUploading({ brokerId });
            }}
          />
        ) : null}
      </div>
    </>
  );
}
