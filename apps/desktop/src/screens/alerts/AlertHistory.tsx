import { useState } from 'react';
import { useEvent } from '../../api/services';
import { useResource } from '../../api/useResource';
import type { AlertEvent, AlertKindInfo, WatchItem } from '../../api/types';
import { Card, DataTable, type Column } from '../../design-system';
import { navigate } from '../../app/router';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import common from '../common/screen.module.css';
import { formatDayTime } from '../common/time';
import styles from './alerts.module.css';
import { kindLabel } from './kinds';
import { SelectField } from '../common/SelectField';

/** 이력은 최근 이만큼을 받아 화면에서 거른다(API에는 limit만 있다). */
const LIMIT = 200;
const EVENT_KIND = 'event';

const columns: Column<AlertEvent>[] = [
  {
    key: 'time',
    header: '시각',
    width: '7.5rem',
    cell: (e) => <span className={`${styles.time} vt-num`}>{formatDayTime(e.fired_at)}</span>,
  },
  { key: 'message', header: '내용', cell: (e) => e.message },
];

const keyOf = (e: { market: string | null; code: string | null }) =>
  e.market && e.code ? `${e.market}:${e.code}` : null;

export interface AlertHistoryProps {
  watchItems: WatchItem[] | undefined;
  kinds: AlertKindInfo[] | undefined;
  /** 종목 주소(#/symbols/...)로 열었으면 그 종목. 사용자가 고르기 전까지 필터가 따라간다. */
  focusKey: string | null;
}

/** 알림 이력(GET /alerts/events + SSE alert.fired), 종목·종류 필터. 행을 누르면 그 종목으로. */
export function AlertHistory({ watchItems, kinds, focusKey }: AlertHistoryProps) {
  const events = useResource<AlertEvent[]>(`/alerts/events?limit=${LIMIT}`, (api) =>
    api.request<AlertEvent[]>('/alerts/events', { query: { limit: LIMIT } }),
  );
  useEvent('alert.fired', (fired) =>
    events.mutate((list) => [fired, ...(list ?? []).filter((e) => e.id !== fired.id)]),
  );
  const [symbolChoice, setSymbolChoice] = useState<string | null>(null);
  const [kind, setKind] = useState('');
  const symbol = symbolChoice ?? focusKey ?? '';

  const list = events.data;
  const symbolOptions = new Map<string, string>();
  for (const w of watchItems ?? []) symbolOptions.set(`${w.market}:${w.code}`, w.name);
  for (const e of list ?? []) {
    const key = keyOf(e);
    if (key && !symbolOptions.has(key)) symbolOptions.set(key, e.name ?? e.code ?? key);
  }
  if (symbol && !symbolOptions.has(symbol))
    symbolOptions.set(symbol, symbol.split(':')[1] ?? symbol);

  const filtered = (list ?? []).filter(
    (e) =>
      (!symbol || keyOf(e) === symbol) &&
      (!kind || (kind === EVENT_KIND ? e.kind === null : e.kind === kind)),
  );

  return (
    <Card title="알림 이력" description={list ? `${filtered.length}건` : undefined}>
      {list && list.length > 0 ? (
        <div className={styles.filters}>
          <SelectField
            label="종목"
            value={symbol}
            onChange={setSymbolChoice}
            options={[
              { value: '', label: '전체 종목' },
              ...[...symbolOptions].map(([value, name]) => ({ value, label: name })),
            ]}
          />
          <SelectField
            label="종류"
            value={kind}
            onChange={setKind}
            options={[
              { value: '', label: '전체 종류' },
              ...(kinds ?? []).map((k) => ({ value: k.kind, label: kindLabel(k.kind) })),
              { value: EVENT_KIND, label: '분석 완료·실패' },
            ]}
          />
        </div>
      ) : null}
      {events.error ? (
        <ApiErrorNotice
          error={events.error}
          title="알림 이력을 불러오지 못했습니다"
          onRetry={events.reload}
        />
      ) : null}
      {list && list.length === 0 ? (
        <p className={common.empty}>
          아직 울린 알림이 없습니다. 규칙을 만들면 조건이 맞을 때 여기에 쌓입니다.
        </p>
      ) : null}
      {list && list.length > 0 && filtered.length === 0 ? (
        <p className={common.empty}>조건에 맞는 알림이 없습니다.</p>
      ) : null}
      {filtered.length > 0 ? (
        <DataTable
          caption="알림 이력"
          columns={columns}
          rows={filtered}
          rowKey={(e) => String(e.id)}
          onRowActivate={(e) => {
            // 분석 완료·실패 이력에는 종목·분석 id가 없어(AlertEventOut) 이동할 곳이 없다
            if ((e.market === 'KR' || e.market === 'US') && e.code) {
              navigate({ name: 'symbol', market: e.market, code: e.code });
            }
          }}
        />
      ) : null}
    </Card>
  );
}
