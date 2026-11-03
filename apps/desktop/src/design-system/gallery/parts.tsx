/* 견본에서 여러 번 쓰는 조합. 실제 화면 코드가 아니라 컴포넌트를 함께 쓰는 예시다. */
import { DataTable, type Column } from '../components/DataTable';
import { FeedStatus } from '../components/FeedStatus';
import { SignedNumber } from '../components/SignedNumber';
import { Sparkline } from '../components/Sparkline';
import { directionOf, formatNumber, formatPrice, formatPriceChange } from '../format/money';
import styles from './gallery.module.css';
import { flows, indices, watchlist, type IndexRow, type WatchRow } from './sample';

const watchColumns: Column<WatchRow>[] = [
  {
    key: 'name',
    header: '종목',
    truncate: true,
    cell: (r) => (
      <span className={styles.stock}>
        <span className={styles.market}>{r.market === 'KR' ? '국내' : '미국'}</span>
        <b>{r.name}</b>
        <span className={`${styles.stockCode} vt-num`}>{r.code}</span>
      </span>
    ),
  },
  { key: 'price', header: '현재가', numeric: true, cell: (r) => formatPrice(r.price, r.currency) },
  {
    key: 'change',
    header: '전일 대비',
    numeric: true,
    cell: (r) => <SignedNumber value={r.change} format={r.currency === 'KRW' ? 'won' : 'usd'} />,
  },
  {
    key: 'pct',
    header: '등락률',
    numeric: true,
    cell: (r) => <SignedNumber value={r.changePct} format="percent" />,
  },
  {
    key: 'feed',
    header: <span className={styles.feedHead}>수신</span>,
    width: '7.5rem',
    cell: (r) => (
      <span className={styles.feedCell}>
        <FeedStatus state={r.feed} intervalSeconds={r.pollSeconds} />
      </span>
    ),
  },
];

export function WatchTable({
  onOpen,
  offline = false,
}: {
  onOpen?: (row: WatchRow) => void;
  /** 오프라인이면 장중 종목의 수신 상태를 모두 끊김으로(장 마감 종목은 그대로). */
  offline?: boolean;
}) {
  const rows = offline
    ? watchlist.map((r) => (r.feed === 'closed' ? r : { ...r, feed: 'disconnected' as const }))
    : watchlist;
  return (
    <DataTable
      caption="감시 종목"
      columns={watchColumns}
      rows={rows}
      rowKey={(r) => r.code}
      onRowActivate={onOpen}
    />
  );
}

const indexColumns: Column<IndexRow>[] = [
  { key: 'name', header: '지수', cell: (r) => <b>{r.name}</b> },
  { key: 'close', header: '종가', numeric: true, cell: (r) => formatNumber(r.close, 2) },
  {
    key: 'change',
    header: '전일 대비',
    numeric: true,
    cell: (r) => <SignedNumber value={r.change} format="number" decimals={2} />,
  },
  {
    key: 'pct',
    header: '등락률',
    numeric: true,
    cell: (r) => <SignedNumber value={r.changePct} format="percent" />,
  },
  {
    key: 'spark',
    header: <span className={styles.sparkHead}>최근 30일</span>,
    width: '7rem',
    cell: (r) => (
      <span className={styles.sparkCell}>
        <Sparkline
          values={r.closes}
          label={`${r.name} 최근 30일 종가`}
          direction={directionOf(r.change)}
        />
      </span>
    ),
  },
];

export function IndexTable() {
  return <DataTable caption="지수" columns={indexColumns} rows={indices} rowKey={(r) => r.name} />;
}

export function FlowsLine() {
  return (
    <p className={styles.flows}>
      <span className={styles.flowsKey}>코스피 수급</span>
      외국인 <SignedNumber value={flows.foreign} format="eok" /> · 기관{' '}
      <SignedNumber value={flows.institution} format="eok" /> · 개인{' '}
      <SignedNumber value={flows.individual} format="eok" />
    </p>
  );
}

/** 문장 안 가격 표기 예: "삼성전자 71,400원 (+1,200원)". */
export function priceSentence(row: WatchRow): string {
  return `${row.name} ${formatPrice(row.price, row.currency)} (${formatPriceChange(row.change, row.currency)})`;
}
