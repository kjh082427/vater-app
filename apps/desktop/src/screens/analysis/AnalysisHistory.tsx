import { useState } from 'react';
import { useResource } from '../../api/useResource';
import type { AnalysisItem } from '../../api/types';
import { Card, DataTable, DecisionScale, type Column } from '../../design-system';
import { navigate } from '../../app/router';
import { PRESET_LABEL } from '../../app/status';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import form from '../common/form.module.css';
import { StockName } from '../common/quotes';
import common from '../common/screen.module.css';
import { formatDay, formatDayTime } from '../common/time';
import { toDecision } from './decision';
import { STATUS_LABEL } from './stages';
import { SelectField } from '../common/SelectField';

const LIMIT = 50;

const columns: Column<AnalysisItem>[] = [
  {
    key: 'name',
    header: '종목',
    cell: (a) => <StockName market={a.market} name={a.name ?? a.code} code={a.code} />,
  },
  {
    key: 'asOf',
    header: '기준일',
    width: '8rem',
    cell: (a) => <span className="vt-num">{formatDay(a.as_of)}</span>,
  },
  {
    key: 'preset',
    header: 'AI 사용 방식',
    width: '5rem',
    cell: (a) => PRESET_LABEL[a.preset] ?? a.preset,
  },
  {
    key: 'decision',
    header: '의견',
    width: '13rem',
    cell: (a) =>
      a.status === 'done' ? (
        <span className={common.stock}>
          <DecisionScale decision={toDecision(a.decision)} />
          {a.decision_changed ? <span className={common.stockMeta}>직전과 다름</span> : null}
        </span>
      ) : (
        (STATUS_LABEL[a.status] ?? a.status)
      ),
  },
  {
    key: 'created',
    header: '요청 시각',
    width: '8rem',
    cell: (a) => <span className="vt-num">{formatDayTime(a.created_at)}</span>,
  },
];

/** 분석 이력(종목별, 결정 바뀜 표시). 분석 상태 SSE가 오면 다시 불러온다. */
export function AnalysisHistory() {
  const [symbol, setSymbol] = useState('');
  const all = useResource<AnalysisItem[]>(
    `/analyses?limit=${LIMIT}`,
    (api) => api.request<AnalysisItem[]>('/analyses', { query: { limit: LIMIT } }),
    { refreshOn: ['analysis.status'] },
  );
  const [market, code] = symbol.split(':');
  const filtered = useResource<AnalysisItem[]>(
    symbol ? `/analyses?symbol=${symbol}` : null,
    (api) => api.request<AnalysisItem[]>('/analyses', { query: { market, code, limit: LIMIT } }),
    { refreshOn: ['analysis.status'] },
  );
  const current = symbol ? filtered : all;
  const rows = current.data;

  const options = new Map<string, string>();
  for (const a of all.data ?? []) options.set(`${a.market}:${a.code}`, a.name ?? a.code);

  return (
    <Card title="분석 이력" description={rows && rows.length > 0 ? `${rows.length}건` : undefined}>
      {(all.data?.length ?? 0) > 0 ? (
        <div className={form.row}>
          <SelectField
            label="종목"
            value={symbol}
            onChange={setSymbol}
            options={[
              { value: '', label: '전체 종목' },
              ...[...options].map(([value, name]) => ({ value, label: name })),
            ]}
          />
        </div>
      ) : null}
      {current.error ? (
        <ApiErrorNotice
          error={current.error}
          title="분석 이력을 불러오지 못했습니다"
          onRetry={current.reload}
        />
      ) : null}
      {rows && rows.length === 0 ? (
        <p className={common.empty}>
          아직 분석한 종목이 없습니다. 위에서 종목을 골라 분석을 시작하세요.
        </p>
      ) : null}
      {rows && rows.length > 0 ? (
        <DataTable
          caption="분석 이력"
          columns={columns}
          rows={rows}
          rowKey={(a) => String(a.id)}
          onRowActivate={(a) => navigate({ name: 'analysis', id: a.id })}
        />
      ) : null}
    </Card>
  );
}
