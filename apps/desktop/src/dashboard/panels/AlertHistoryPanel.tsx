import type { AlertEvent } from '../../api/types';
import { navigate } from '../../app/router';
import { DataTable, type Column } from '../../design-system';
import { KIND_GROUP } from '../../screens/alerts/kinds';
import { formatDayTime } from '../../screens/common/time';
import { useShared } from '../shared';
import { alertEventsSource, quotesSource } from '../sources';
import { PanelEmpty, PanelError, styles } from './common';
import type { Choice, PanelProps } from './types';

const EVENT_GROUP = '이벤트';
/** 종류 묶음(감시·알림의 분류) + 종목이 없는 이벤트 알림. */
export const KIND_CHOICES: Choice[] = [
  { value: 'all', label: '전체 종류' },
  ...[...new Set(Object.values(KIND_GROUP)), EVENT_GROUP].map((g) => ({ value: g, label: g })),
];

const groupOf = (e: AlertEvent) => (e.kind ? (KIND_GROUP[e.kind] ?? EVENT_GROUP) : EVENT_GROUP);

/** 종목 고르기: 전체 + 감시 종목. */
export function useSymbolChoices(): Choice[] {
  const quotes = useShared(quotesSource);
  return [
    { value: 'all', label: '전체 종목' },
    ...(quotes.data ?? []).map((q) => ({ value: `${q.market}:${q.code}`, label: q.name })),
  ];
}

const TIME: Column<AlertEvent> = {
  key: 'at',
  header: '시각',
  width: '7.5rem',
  cell: (e) => <span className="vt-num">{formatDayTime(e.fired_at)}</span>,
};
const NAME: Column<AlertEvent> = {
  key: 'name',
  header: '종목',
  width: '6.5rem',
  cell: (e) => e.name ?? e.code ?? '—',
};
const MESSAGE: Column<AlertEvent> = { key: 'message', header: '내용', cell: (e) => e.message };

/** 좁은 칸은 종목 열을 뺀다(내용에 종목 이름이 들어 있다). */
const columnsFor = (width: number) => (width >= 520 ? [TIME, NAME, MESSAGE] : [TIME, MESSAGE]);

/** 알림 이력: 종목·종류로 거른 알림 표. 행을 누르면 그 종목의 감시·알림. */
export function AlertHistoryPanel({ options, size }: PanelProps) {
  const events = useShared(alertEventsSource);
  const kind = typeof options.kind === 'string' ? options.kind : 'all';
  const symbol = typeof options.symbol === 'string' ? options.symbol : 'all';
  if (events.error) {
    return (
      <PanelError
        error={events.error}
        title="알림 이력을 불러오지 못했습니다"
        onRetry={events.reload}
      />
    );
  }
  if (!events.data) return <div className={styles.body} aria-busy="true" />;
  const rows = events.data.filter(
    (e) =>
      (kind === 'all' || groupOf(e) === kind) &&
      (symbol === 'all' || `${e.market}:${e.code}` === symbol),
  );
  if (rows.length === 0) {
    return (
      <PanelEmpty>
        {events.data.length === 0
          ? '아직 울린 알림이 없습니다.'
          : '고른 종목·종류의 알림이 없습니다. 배치 편집에서 거르기를 바꿀 수 있습니다.'}
      </PanelEmpty>
    );
  }
  return (
    <div className={styles.body}>
      <DataTable
        caption="알림 이력"
        columns={columnsFor(size.w)}
        rows={rows}
        rowKey={(e) => String(e.id)}
        onRowActivate={(e) => {
          if ((e.market === 'KR' || e.market === 'US') && e.code) {
            navigate({ name: 'symbol', market: e.market, code: e.code });
          }
        }}
      />
    </div>
  );
}
