import { useEffect, useMemo, useState } from 'react';
import { toApiError, type ApiError } from '../../api/errors';
import { useApi } from '../../api/services';
import type { BrokerOut, CsvPreview, CsvRow, HoldingOut } from '../../api/types';
import {
  Button,
  DataTable,
  formatNumber,
  formatPrice,
  formatQuantity,
  type Column,
} from '../../design-system';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import { Field } from '../common/Field';
import form from '../common/form.module.css';
import { currencyOf } from '../common/quotes';
import { SelectField } from '../common/SelectField';
import { BrokerPicker } from './BrokerPicker';
import styles from './holdings.module.css';

type ColKey = 'name_col' | 'code_col' | 'quantity_col' | 'avg_price_col';
const COLS: { key: ColKey; guess: keyof CsvPreview['guess']; label: string }[] = [
  { key: 'name_col', guess: 'name', label: '종목명 열' },
  { key: 'code_col', guess: 'code', label: '종목코드 열' },
  { key: 'quantity_col', guess: 'quantity', label: '수량 열' },
  { key: 'avg_price_col', guess: 'avg_price', label: '평균 매수가 열' },
];
const AUTO = '';
const NO_PICKS: Record<number, Pick> = {};

interface Pick {
  market: 'KR' | 'US';
  code: string;
  name: string;
}

interface Judged {
  row: CsvRow;
  /** 올릴 수 있으면 그 종목. */
  target: Pick | null;
  error: string | null;
}

/** 후보로 고른 종목을 반영하고, 같은 종목이 두 번 있으면 뒤의 것을 올리지 않는다. */
function judge(rows: CsvRow[], picks: Record<number, Pick>): Judged[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    const picked = picks[row.row];
    let target: Pick | null = null;
    let error = row.error;
    if (row.market && row.code && !row.error) {
      target = { market: row.market, code: row.code, name: row.name };
    } else if (picked) {
      target = picked;
      error = null;
      if (row.quantity === null) error = '수량이 올바르지 않습니다.';
      else if (row.avg_price === null) error = '평균 매수가가 없거나 올바르지 않습니다.';
    }
    if (target && !error) {
      const key = `${target.market}:${target.code}`;
      if (seen.has(key)) error = '같은 종목이 두 번 있습니다.';
      seen.add(key);
    }
    return { row, target: error ? null : target, error };
  });
}

export interface CsvImportProps {
  /** 직접 입력할 수 있는 증권사. */
  brokers: BrokerOut[];
  /** 지금 저장된 보유(변경 요약 계산용). 아직 못 받았으면 사이드카가 센 값을 쓴다. */
  holdings: HoldingOut[] | undefined;
  onBrokersChanged: () => void;
  /** 올리기가 끝났다. */
  onDone: (brokerId: string) => void;
}

/**
 * CSV 가져오기(스펙 14장): 파일 → 증권사 클릭 → 열 확인 → 미리보기(오류 행 이유, 후보 고르기) → 변경 요약 → 올리기.
 * 파일은 읽은 바이트 그대로 보낸다(CP949와 UTF-8을 사이드카가 읽는다). 올리면 그 증권사의 수동 항목을
 * 파일 내용으로 바꾼다. 필수 값이 빠진 행과 찾지 못한 종목은 올리지 않는다.
 */
export function CsvImport({ brokers, holdings, onBrokersChanged, onDone }: CsvImportProps) {
  const api = useApi();
  const [file, setFile] = useState<{ id: number; bytes: ArrayBuffer } | null>(null);
  const [brokerId, setBrokerId] = useState('');
  const [cols, setCols] = useState<Partial<Record<ColKey, string>>>({});
  // 요청 하나의 결과. 파일·증권사·열이 바뀌어 key가 달라지면 이전 결과는 쓰지 않는다
  const [result, setResult] = useState<{
    key: string;
    preview: CsvPreview | null;
    error: ApiError | null;
  } | null>(null);
  const [picked, setPicked] = useState<{ key: string; map: Record<number, Pick> } | null>(null);
  const [fileError, setFileError] = useState<ApiError | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<ApiError | null>(null);
  const key = file && brokerId ? `${file.id}|${brokerId}|${JSON.stringify(cols)}` : null;

  useEffect(() => {
    if (!key || !file) return;
    let alive = true;
    api
      .request<CsvPreview>('/holdings/csv/preview', {
        method: 'POST',
        body: file.bytes,
        contentType: 'text/csv',
        query: { broker_id: brokerId, ...cols },
      })
      .then(
        (preview) => alive && setResult({ key, preview, error: null }),
        (e: unknown) => alive && setResult({ key, preview: null, error: toApiError(e) }),
      );
    return () => {
      alive = false;
    };
  }, [api, key, file, brokerId, cols]);

  const current = result?.key === key ? result : null;
  const busy = key !== null && current === null;
  // 열·증권사를 바꾸면 새 결과가 올 때까지 이전 미리보기를 둔다(열 선택 칸이 사라져 포커스를 잃지 않게).
  // 파일이 바뀌면 이전 파일의 결과는 쓰지 않는다.
  const shown = current ?? (result && file && result.key.startsWith(`${file.id}|`) ? result : null);
  const preview = shown?.preview ?? null;
  const error = commitError ?? current?.error ?? fileError;
  const picks = picked?.key === key ? picked.map : NO_PICKS;

  const judged = useMemo(() => (preview ? judge(preview.rows, picks) : []), [preview, picks]);
  const good = judged.filter((j) => j.target !== null);
  const skipped = judged.length - good.length;

  const changes = useMemo(() => {
    if (!preview) return null;
    if (!holdings) return preview.changes;
    const mine = new Set(
      holdings
        .filter((h) => h.broker_id === brokerId && h.source !== 'api')
        .map((h) => `${h.market}:${h.code}`),
    );
    const next = new Set(good.map((j) => `${j.target?.market}:${j.target?.code}`));
    return {
      added: [...next].filter((k) => !mine.has(k)).length,
      updated: [...next].filter((k) => mine.has(k)).length,
      removed: [...mine].filter((k) => !next.has(k)).length,
    };
  }, [preview, holdings, brokerId, good]);

  async function pickFile(chosen: File | undefined) {
    if (!chosen) return;
    setFileError(null);
    setCommitError(null);
    setCols({});
    try {
      const bytes = await chosen.arrayBuffer();
      setFile((prev) => ({ id: (prev?.id ?? 0) + 1, bytes }));
    } catch {
      setFile(null);
      setFileError(toApiError(new Error('file'))); // 일반 문구: 파일을 읽지 못했습니다
    }
  }

  async function commit() {
    setCommitting(true);
    setCommitError(null);
    try {
      await api.request('/holdings/csv/commit', {
        method: 'POST',
        body: {
          broker_id: brokerId,
          rows: good.map((j) => ({
            market: j.target?.market,
            code: j.target?.code,
            quantity: j.row.quantity,
            avg_price: j.row.avg_price,
          })),
        },
      });
      onDone(brokerId);
    } catch (e) {
      setCommitError(toApiError(e));
    } finally {
      setCommitting(false);
    }
  }

  const columns: Column<Judged>[] = [
    { key: 'row', header: '행', numeric: true, width: '3rem', cell: (j) => j.row.row },
    {
      key: 'name',
      header: '종목',
      truncate: true,
      cell: (j) => (j.target ? `${j.target.name} ${j.target.code}` : j.row.name),
    },
    {
      key: 'qty',
      header: '수량',
      numeric: true,
      cell: (j) =>
        j.row.quantity === null ? '—' : formatQuantity(j.row.quantity, j.target?.market ?? 'US'),
    },
    {
      key: 'avg',
      header: '평균 매수가',
      numeric: true,
      cell: (j) =>
        j.row.avg_price === null
          ? '—'
          : j.target
            ? formatPrice(j.row.avg_price, currencyOf(j.target.market))
            : // 종목을 모르면 통화도 모른다: 원·달러를 붙이지 않는다
              formatNumber(j.row.avg_price, Number.isInteger(j.row.avg_price) ? 0 : 2),
    },
    {
      key: 'state',
      header: '상태',
      cell: (j) =>
        j.target ? (
          '올릴 수 있음'
        ) : j.row.candidates.length > 0 && !j.row.market ? (
          <span className={styles.candidate}>
            <span className={form.error}>{j.error}</span>
            <SelectField
              label={`${j.row.name} 후보`}
              value=""
              onChange={(v) => {
                const c = j.row.candidates.find((x) => `${x.market}:${x.code}` === v);
                if (c && key) {
                  const chosen: Pick = {
                    market: c.market as 'KR' | 'US',
                    code: c.code,
                    name: c.name,
                  };
                  setPicked({ key, map: { ...picks, [j.row.row]: chosen } });
                }
              }}
              options={[
                { value: '', label: '(고르세요)', disabled: true },
                ...j.row.candidates.map((c) => ({
                  value: `${c.market}:${c.code}`,
                  label: `${c.name} ${c.code}`,
                })),
              ]}
            />
          </span>
        ) : (
          <span className={form.error}>{j.error}</span>
        ),
    },
  ];

  return (
    <div className={styles.stack}>
      <Field
        label="CSV 파일"
        hint="증권사 앱에서 내려받은 보유 종목 파일. 한 번에 1,000행까지, 한글(CP949)과 UTF-8을 읽습니다."
      >
        {(control) => (
          <input
            {...control}
            className={form.control}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => void pickFile(e.target.files?.[0])}
          />
        )}
      </Field>
      <BrokerPicker
        brokers={brokers}
        value={brokerId}
        onChange={(id) => {
          setBrokerId(id);
          setCommitError(null);
        }}
        onAdded={onBrokersChanged}
        error={file && !brokerId ? '증권사를 고르세요.' : undefined}
      />
      {preview ? (
        <div className={styles.inline}>
          {COLS.map((c) => (
            <SelectField
              key={c.key}
              label={c.label}
              value={cols[c.key] ?? preview.guess[c.guess] ?? AUTO}
              onChange={(v) => {
                setCols((prev) => ({ ...prev, [c.key]: v }));
                setCommitError(null);
              }}
              options={[
                { value: AUTO, label: '(자동 추정)' },
                ...preview.columns.map((name) => ({ value: name, label: name })),
              ]}
            />
          ))}
        </div>
      ) : null}
      {busy ? <p className={styles.empty}>파일을 읽는 중…</p> : null}
      {error ? <ApiErrorNotice error={error} title="파일을 읽지 못했습니다" /> : null}
      {preview && preview.rows.length === 0 ? (
        <p className={styles.empty}>
          표시할 행이 없습니다. 위에서 종목, 수량, 평균 매수가 열을 골라 주세요.
        </p>
      ) : null}
      {preview && preview.rows.length > 0 ? (
        <>
          <DataTable
            caption="미리보기"
            columns={columns}
            rows={judged}
            rowKey={(j) => String(j.row.row)}
          />
          <p className={`${styles.note} vt-num`}>
            {changes
              ? `추가 ${changes.added} · 변경 ${changes.updated} · 삭제 ${changes.removed}`
              : null}
          </p>
          <p className={styles.note}>
            {`이 증권사의 직접 입력 항목을 파일 내용으로 바꿉니다.${skipped > 0 ? ` ${skipped}행은 올리지 않습니다(이유는 위 표).` : ''}`}
          </p>
        </>
      ) : null}
      <div className={styles.actions}>
        <Button
          variant="primary"
          busy={committing}
          disabled={!preview || busy || good.length === 0}
          onClick={() => void commit()}
        >
          {`올리기${good.length > 0 ? ` (${good.length}종목)` : ''}`}
        </Button>
      </div>
    </div>
  );
}
