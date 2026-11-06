import { useState } from 'react';
import { toApiError, type ApiError } from '../../api/errors';
import { useApi, useEvent } from '../../api/services';
import { useResource } from '../../api/useResource';
import type { AnalysisItem } from '../../api/types';
import { Banner, Button, Card, DataTable, DecisionScale, type Column } from '../../design-system';
import { navigate } from '../../app/router';
import { PRESET_LABEL } from '../../app/status';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import form from '../common/form.module.css';
import { StockName } from '../common/quotes';
import common from '../common/screen.module.css';
import { formatDay, formatDayTime } from '../common/time';
import { DeleteAnalysisDialog } from './DeleteAnalysisDialog';
import { toDecision } from './decision';
import { isActiveStatus, STATUS_LABEL } from './stages';
import { SelectField } from '../common/SelectField';

const LIMIT = 50;
/** 한 번에 지울 수 있는 최대 건수(사이드카 한도). */
const MAX_DELETE = 50;

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

type Skipped = { id: number; code: string }[];

/** 분석 이력(종목별, 결정 바뀜 표시, 지우기). 분석 상태 SSE가 오면 다시 불러오고, 지운 분석(SSE)은 뺀다. */
export function AnalysisHistory() {
  const api = useApi();
  const [symbol, setSymbol] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<ApiError | null>(null);
  const [skipped, setSkipped] = useState<Skipped>([]);
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

  const drop = (ids: number[]) => {
    const keep = (list: AnalysisItem[] | undefined) => list?.filter((a) => !ids.includes(a.id));
    all.mutate(keep);
    filtered.mutate(keep);
    setSelected((prev) => prev.filter((id) => !ids.includes(id)));
  };
  useEvent('analysis.deleted', (event) => drop(event.ids));

  async function remove() {
    setBusy(true);
    setDeleteError(null);
    try {
      const out = await api.request<{ deleted: number[]; skipped: Skipped }>('/analyses/delete', {
        method: 'POST',
        body: { ids: selected },
      });
      drop(out.deleted);
      setSkipped(out.skipped);
      setConfirming(false);
      if (out.skipped.length > 0) current.reload();
    } catch (e) {
      setDeleteError(toApiError(e));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const deletable = (rows ?? []).filter((a) => !isActiveStatus(a.status));
  const allChecked = deletable.length > 0 && deletable.every((a) => selected.includes(a.id));
  const selectColumn: Column<AnalysisItem> = {
    key: 'select',
    width: '2.5rem',
    header: (
      <input
        type="checkbox"
        aria-label="지울 분석 모두 선택"
        checked={allChecked}
        disabled={deletable.length === 0}
        onChange={() =>
          setSelected(allChecked ? [] : deletable.slice(0, MAX_DELETE).map((a) => a.id))
        }
      />
    ),
    cell: (a) =>
      isActiveStatus(a.status) ? (
        <input
          type="checkbox"
          disabled
          aria-label={`${a.name ?? a.code} 분석 선택`}
          title="진행 중에는 지울 수 없습니다"
        />
      ) : (
        <input
          type="checkbox"
          aria-label={`${a.name ?? a.code} 분석 선택`}
          checked={selected.includes(a.id)}
          onChange={() => toggle(a.id)}
        />
      ),
  };

  const options = new Map<string, string>();
  for (const a of all.data ?? []) options.set(`${a.market}:${a.code}`, a.name ?? a.code);

  return (
    <Card title="분석 이력" description={rows && rows.length > 0 ? `${rows.length}건` : undefined}>
      {(all.data?.length ?? 0) > 0 ? (
        <div className={form.row}>
          <SelectField
            label="종목"
            value={symbol}
            onChange={(value) => {
              // 거른 뒤에는 보이지 않는 분석을 지우지 않도록 고른 것을 비운다
              setSymbol(value);
              setSelected([]);
              setConfirming(false);
            }}
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
      {rows && rows.some((a) => isActiveStatus(a.status)) ? (
        <p className={common.meta}>대기·진행 중인 분석은 지울 수 없습니다.</p>
      ) : null}
      {selected.length > 0 ? (
        <div className={form.row}>
          <span className={common.meta}>{`${selected.length}건 선택`}</span>
          <Button onClick={() => setConfirming(true)}>선택한 분석 지우기</Button>
        </div>
      ) : null}
      {skipped.length > 0 ? (
        <Banner tone="info" title={`${skipped.length}건은 이미 지워졌거나 지우지 못했습니다.`}>
          {skipped.some((s) => s.code === 'ANALYSIS_IN_PROGRESS')
            ? '진행 중인 분석은 끝나거나 취소한 뒤 지울 수 있습니다.'
            : undefined}
        </Banner>
      ) : null}
      {rows && rows.length === 0 ? (
        <p className={common.empty}>
          아직 분석한 종목이 없습니다. 위에서 종목을 골라 분석을 시작하세요.
        </p>
      ) : null}
      {rows && rows.length > 0 ? (
        <DataTable
          caption="분석 이력"
          columns={[selectColumn, ...columns]}
          rows={rows}
          rowKey={(a) => String(a.id)}
          onRowActivate={(a) => navigate({ name: 'analysis', id: a.id })}
        />
      ) : null}
      {confirming ? (
        <DeleteAnalysisDialog
          count={selected.length}
          busy={busy}
          error={deleteError}
          onConfirm={remove}
          onClose={() => {
            setConfirming(false);
            setDeleteError(null);
          }}
        />
      ) : null}
    </Card>
  );
}
