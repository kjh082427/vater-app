/** 브리핑 데이터 표. 숫자는 수집 자료에서만 나오고(D9) design-system 표기 함수로만 꾸민다. */
import {
  type Column,
  DataTable,
  directionOf,
  DivergingBar,
  formatEokChange,
  formatNumber,
  SignedNumber,
  Sparkline,
} from '../../design-system';
import { MissingValue, Price } from '../common/quotes';
import common from '../common/screen.module.css';
import type { FlowRow, IndexRow, RankRow, SectorQuote, WatchRow } from './data';

const num2 = (v: number | null) => (v === null ? <MissingValue /> : formatNumber(v, 2));

const indexColumns: Column<IndexRow>[] = [
  { key: 'name', header: '지수', cell: (r) => <b>{r.name}</b> },
  { key: 'value', header: '종가', numeric: true, cell: (r) => num2(r.value) },
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
    header: <span className={common.afterNumeric}>최근 30일</span>,
    width: '7rem',
    cell: (r) => (
      <span className={common.afterNumeric}>
        {/* 선 색은 옆 숫자와 같은 자료: 그날 전일 대비 방향 */}
        <Sparkline
          values={r.closes}
          label={`${r.name} 최근 30일 종가`}
          direction={directionOf(r.change)}
        />
      </span>
    ),
  },
];

export function IndexTable({ rows }: { rows: IndexRow[] }) {
  return (
    <DataTable caption="지수" columns={indexColumns} rows={rows} rowKey={(r) => r.code || r.name} />
  );
}

const sectorColumns: Column<SectorQuote>[] = [
  { key: 'name', header: '업종', cell: (r) => r.name },
  { key: 'value', header: '지수', numeric: true, cell: (r) => num2(r.value) },
  {
    key: 'pct',
    header: '등락률',
    numeric: true,
    cell: (r) => <SignedNumber value={r.changePct} format="percent" />,
  },
];

export function SectorTable({ caption, rows }: { caption: string; rows: SectorQuote[] }) {
  return (
    <DataTable
      caption={caption}
      columns={sectorColumns}
      rows={rows}
      rowKey={(r) => r.code || r.name}
    />
  );
}

/**
 * 수급: 시장마다 외국인·기관·개인 순매수 가로 막대(원 → 억). 순매수 빨강(오른쪽)·순매도 파랑(왼쪽),
 * 0 기준선(DESIGN 결정 19). 값이 없는 투자자는 막대에서 뺀다.
 */
export function FlowTable({ rows }: { rows: FlowRow[] }) {
  return (
    <div className={common.column}>
      {rows.map((r) => {
        const bars = (
          [
            ['외국인', r.foreign],
            ['기관', r.institution],
            ['개인', r.individual],
          ] as const
        ).flatMap(([label, value]) => (value === null ? [] : [{ label, value }]));
        // 시장마다 막대 길이의 기준(가장 큰 값)이 다르므로 시장 이름을 위에 둔다
        return bars.length > 0 ? (
          <div key={r.market}>
            <p className={common.meta}>{r.label}</p>
            <DivergingBar
              aria-label={`투자자별 순매수 · ${r.label}`}
              format={formatEokChange}
              rows={bars}
            />
          </div>
        ) : null;
      })}
    </div>
  );
}

/** 거래대금(원) → 억 원 숫자(단위는 열 머리). 10억 미만은 소수 1자리. */
function eokAmount(won: number | null) {
  if (won === null) return <MissingValue />;
  const eok = won / 1e8;
  return formatNumber(eok, Math.abs(eok) < 10 ? 1 : 0);
}

function rankColumns(withValue: boolean): Column<RankRow>[] {
  const columns: Column<RankRow>[] = [
    {
      key: 'rank',
      header: '순위',
      numeric: true,
      width: '3.5rem',
      cell: (r) => (r.rank === null ? '' : formatNumber(r.rank)),
    },
    {
      key: 'name',
      header: <span className={common.afterNumeric}>종목</span>,
      cell: (r) => (
        <span className={common.afterNumeric}>
          <span className={common.stock}>
            <b>{r.name}</b>
            <span className={`${common.stockMeta} vt-num`}>{r.code}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'price',
      header: '현재가',
      numeric: true,
      cell: (r) => <Price value={r.price} market="KR" />,
    },
    {
      key: 'pct',
      header: '등락률',
      numeric: true,
      cell: (r) => <SignedNumber value={r.changePct} format="percent" />,
    },
  ];
  if (withValue) {
    columns.push({
      key: 'value',
      header: '거래대금(억 원)',
      numeric: true,
      cell: (r) => eokAmount(r.tradingValue),
    });
  }
  return columns;
}

export function RankTable({
  caption,
  rows,
  withValue = false,
}: {
  caption: string;
  rows: RankRow[];
  withValue?: boolean;
}) {
  return (
    <DataTable
      caption={caption}
      columns={rankColumns(withValue)}
      rows={rows}
      rowKey={(r) => `${r.rank ?? ''}:${r.code}`}
      empty="자료가 없습니다."
    />
  );
}

export function WatchTable({ rows, market }: { rows: WatchRow[]; market: string }) {
  const columns: Column<WatchRow>[] = [
    {
      key: 'name',
      header: '종목',
      cell: (r) => (
        <span className={common.stock}>
          <b>{r.name}</b>
          <span className={`${common.stockMeta} vt-num`}>{r.code}</span>
        </span>
      ),
    },
    {
      key: 'price',
      header: '종가',
      numeric: true,
      cell: (r) => <Price value={r.price} market={market} />,
    },
    {
      key: 'pct',
      header: '등락률',
      numeric: true,
      cell: (r) => <SignedNumber value={r.changePct} format="percent" />,
    },
  ];
  return <DataTable caption="내 감시 종목" columns={columns} rows={rows} rowKey={(r) => r.code} />;
}
