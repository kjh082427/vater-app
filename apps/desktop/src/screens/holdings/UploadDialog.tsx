import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toApiError, type ApiError } from '../../api/errors';
import { useApi } from '../../api/services';
import type {
  AlertKindInfo,
  BrokerOut,
  ConnectionOut,
  HoldingOut,
  MonitorStatus,
  SyncResult,
  WatchItem,
  WatchResult,
} from '../../api/types';
import { Banner, Button, Dialog } from '../../design-system';
import { formToParams, initialForm, kindLabel, paramFields } from '../alerts/kinds';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import { Field } from '../common/Field';
import form from '../common/form.module.css';
import { SelectField } from '../common/SelectField';
import styles from './holdings.module.css';
import { holdingKey, newSymbolCount, uploadRows } from './model';

/** 목표가 규칙은 종목마다 값이 달라 일괄 적용에서 뺀다(스펙 6장). */
const NO_BULK = new Set(['price_above', 'price_below']);

export interface UploadButtonsProps {
  brokers: BrokerOut[];
  connections: ConnectionOut[];
  holdings: HoldingOut[];
  watchedKeys: ReadonlySet<string>;
  /** 증권사·연결·보유를 모두 받았다. 받는 중이거나 실패했으면 연결 안내를 보이지 않는다. */
  ready: boolean;
  onOpen: (brokerId: string | null) => void;
  /** 이 버튼 줄 뒤에 붙는 것(보유 내역 직접 입력). */
  children?: ReactNode;
}

/** 업로드 버튼 줄: 연결했거나 보유가 있는 증권사만 보인다. 하나도 없으면 연결 안내. */
export function UploadButtons({
  brokers,
  connections,
  holdings,
  watchedKeys,
  ready,
  onOpen,
  children,
}: UploadButtonsProps) {
  const ids = new Set([
    ...connections.filter((c) => c.status !== 'disconnected').map((c) => c.broker_id),
    ...holdings.map((h) => h.broker_id),
  ]);
  const shown = brokers.filter((b) => ids.has(b.id));
  const fresh = newSymbolCount(holdings, watchedKeys);
  return (
    <div className={styles.uploadBar}>
      {shown.length === 0 ? (
        ready ? (
          <p className={styles.empty}>
            증권사를 연결하면 보유 종목을 불러옵니다. <a href="#/settings">설정 &gt; 증권사 연결</a>
          </p>
        ) : null
      ) : (
        <>
          {shown.map((b) => (
            <Button key={b.id} onClick={() => onOpen(b.id)}>
              {b.name}
            </Button>
          ))}
          {shown.length > 1 ? (
            <Button onClick={() => onOpen(null)}>연결한 증권사 모두</Button>
          ) : null}
          {fresh > 0 ? <span className={styles.newCount}>{`새 종목 ${fresh}개`}</span> : null}
        </>
      )}
      {children}
    </div>
  );
}

interface Loaded {
  holdings: HoldingOut[];
  watched: Set<string>;
  failed: SyncResult[];
  syncError: ApiError | null;
  realtime: number;
  maxRealtime: number;
  pollSec: number;
}

export interface UploadDialogProps {
  /** null이면 연결한 증권사 모두. */
  brokerId: string | null;
  brokers: BrokerOut[];
  kinds: AlertKindInfo[] | undefined;
  onClose: () => void;
  onUploaded: (result: WatchResult) => void;
}

/**
 * 업로드 확인 창(스펙 2장). 열면 먼저 그 증권사를 갱신하고, 불러온 보유 종목을 보여 준다.
 * 보유 내역은 항상 전부 저장되고, 체크는 감시 종목에 넣을지만 정한다. 체크하지 않은 종목은
 * seen으로 보내 다시 새 종목으로 세지 않는다. 보유 수량·평단가는 이 창에서 어디로도 나가지 않는다.
 */
export function UploadDialog({ brokerId, brokers, kinds, onClose, onUploaded }: UploadDialogProps) {
  const api = useApi();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [ruleKind, setRuleKind] = useState('');
  const [ruleForm, setRuleForm] = useState<Record<string, string>>({});
  const [ruleErrors, setRuleErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const brokerName = (id: string) => brokers.find((b) => b.id === id)?.name ?? id;
  const title = brokerId ? brokerName(brokerId) : '연결한 증권사 모두';

  useEffect(() => {
    let alive = true;
    (async () => {
      let results: SyncResult[] = [];
      let syncError: ApiError | null = null;
      try {
        results = await api.request<SyncResult[]>('/holdings/sync', {
          method: 'POST',
          body: brokerId ? { broker_id: brokerId } : {},
        });
      } catch (e) {
        syncError = toApiError(e); // 갱신이 안 되어도 저장된 내역은 보여 준다
      }
      try {
        const [holdings, watch, status, settings] = await Promise.all([
          api.request<HoldingOut[]>('/holdings'),
          api.request<WatchItem[]>('/watchlist'),
          api.request<MonitorStatus>('/alerts/status'),
          api.request<Record<string, unknown>>('/settings'),
        ]);
        if (!alive) return;
        const watched = new Set(watch.map(holdingKey));
        const mine = brokerId ? holdings.filter((h) => h.broker_id === brokerId) : holdings;
        setLoaded({
          holdings: mine,
          watched,
          failed: results.filter((r) => !r.ok),
          syncError,
          realtime: status.realtime,
          maxRealtime: Number(settings['kis.ws_max_subscriptions'] ?? 41),
          pollSec: Number(settings['alerts.poll_interval_sec'] ?? 30),
        });
        setChecked(
          new Set(
            uploadRows(mine, watched)
              .filter((r) => r.supported && !r.watched)
              .map((r) => r.key),
          ),
        );
      } catch (e) {
        if (alive) setError(toApiError(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [api, brokerId]);

  const rows = useMemo(() => (loaded ? uploadRows(loaded.holdings, loaded.watched) : []), [loaded]);
  const selectable = rows.filter((r) => r.supported && !r.watched);
  const selected = selectable.filter((r) => checked.has(r.key));
  const bulkKinds = (kinds ?? []).filter((k) => !NO_BULK.has(k.kind));
  const kind = bulkKinds.find((k) => k.kind === ruleKind);
  const showFields = kind?.kind === 'avg_price_pct';

  function pickRule(next: string) {
    setRuleKind(next);
    setRuleErrors({});
    const k = bulkKinds.find((x) => x.kind === next);
    setRuleForm(k ? initialForm(k) : {});
  }

  async function upload() {
    let rule: { kind: string; params?: Record<string, unknown> } | undefined;
    if (kind) {
      if (showFields) {
        const parsed = formToParams(kind, ruleForm);
        if (!parsed.ok) {
          setRuleErrors(parsed.errors);
          return;
        }
        rule = { kind: kind.kind, params: parsed.params };
      } else {
        rule = { kind: kind.kind };
      }
    }
    setBusy(true);
    setError(null);
    try {
      const target = (r: (typeof rows)[number]) => ({
        market: r.market as 'KR' | 'US',
        code: r.code,
      });
      const result = await api.request<WatchResult>('/holdings/watch', {
        method: 'POST',
        body: {
          items: selected.map(target),
          seen: selectable.filter((r) => !checked.has(r.key)).map(target),
          ...(rule && selected.length > 0 ? { rule } : {}),
        },
      });
      onUploaded(result);
    } catch (e) {
      setError(toApiError(e));
      setBusy(false);
    }
  }

  const toggle = (key: string, on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const realtime = kind?.timing === 'realtime';

  return (
    <Dialog
      open
      title={`보유 종목 올리기: ${title}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!loaded || selectable.length === 0}
            onClick={() => void upload()}
          >
            {selected.length > 0 ? `감시 종목에 올리기 (${selected.length})` : '확인만 하기'}
          </Button>
        </>
      }
    >
      <div className={styles.stack}>
        {!loaded && !error ? <p className={styles.empty}>보유 내역을 불러오는 중…</p> : null}
        {loaded?.syncError ? (
          <ApiErrorNotice error={loaded.syncError} title="보유 내역을 새로 받지 못했습니다" />
        ) : null}
        {loaded?.failed.map((r) => (
          <Banner
            key={r.connection_id}
            tone="caution"
            title={`${brokerName(r.broker_id)}에서 불러오지 못했습니다`}
          >
            {[r.error?.message, r.error?.hint].filter(Boolean).join(' ')}
          </Banner>
        ))}
        {loaded && rows.length === 0 ? (
          <p className={styles.empty}>올릴 보유 종목이 없습니다.</p>
        ) : null}
        {loaded && rows.length > 0 ? (
          <>
            <div className={styles.pickHead}>
              <label className={form.choice}>
                <input
                  type="checkbox"
                  aria-label="전체 선택"
                  disabled={selectable.length === 0}
                  checked={selectable.length > 0 && selected.length === selectable.length}
                  onChange={(e) =>
                    setChecked(e.target.checked ? new Set(selectable.map((r) => r.key)) : new Set())
                  }
                />
                <span aria-hidden="true">전체 선택</span>
              </label>
              <span className="vt-num">{`${selected.length}종목 선택`}</span>
            </div>
            <ul className={styles.pick} aria-label="보유 종목">
              {rows.map((r) => {
                const off = !r.supported || r.watched;
                const state = !r.supported
                  ? (r.reason ?? '지원하지 않는 종목')
                  : r.watched
                    ? '이미 감시 중'
                    : r.isNew
                      ? '새 종목'
                      : '';
                return (
                  <li key={r.key} className={styles.pickRow}>
                    <label className={`${styles.pickLabel} ${off ? styles.pickDisabled : ''}`}>
                      <input
                        type="checkbox"
                        disabled={off}
                        checked={!off && checked.has(r.key)}
                        onChange={(e) => toggle(r.key, e.target.checked)}
                      />
                      <b>{r.name}</b>
                      <span className="vt-num">{r.code}</span>
                    </label>
                    <span className={styles.pickState}>{state}</span>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
        {loaded && rows.length > 0 && kinds ? (
          <>
            <SelectField
              label="알림 규칙"
              hint="체크한 종목에 한꺼번에 적용합니다. 목표가 규칙은 종목마다 값이 달라 종목 화면에서 따로 추가합니다."
              value={ruleKind}
              onChange={pickRule}
              options={[
                { value: '', label: '규칙 없음' },
                ...bulkKinds.map((k) => ({ value: k.kind, label: kindLabel(k.kind) })),
              ]}
            />
            {showFields && kind ? (
              <div className={styles.inline}>
                {paramFields(kind, 'KR').map((f) =>
                  f.type === 'select' ? (
                    <SelectField
                      key={f.name}
                      label={f.label}
                      value={ruleForm[f.name] ?? ''}
                      onChange={(v) => setRuleForm((prev) => ({ ...prev, [f.name]: v }))}
                      options={f.options ?? []}
                    />
                  ) : (
                    <Field key={f.name} label={f.label} error={ruleErrors[f.name]}>
                      {(control) => (
                        <input
                          {...control}
                          className={`${form.control} vt-num`}
                          inputMode="decimal"
                          autoComplete="off"
                          value={ruleForm[f.name] ?? ''}
                          onChange={(e) =>
                            setRuleForm((prev) => ({ ...prev, [f.name]: e.target.value }))
                          }
                        />
                      )}
                    </Field>
                  ),
                )}
              </div>
            ) : null}
            {realtime && loaded ? (
              <p className={styles.note}>
                {`실시간 감시는 최대 ${loaded.maxRealtime}종목입니다. 넘는 종목은 약 ${loaded.pollSec}초마다 가격을 확인해 알림을 보냅니다. 사용량 ${loaded.realtime + selected.length}/${loaded.maxRealtime}`}
              </p>
            ) : null}
          </>
        ) : null}
        <p className={styles.note}>감시 종목은 브리핑 작성 때 AI로 전송됩니다.</p>
        <p className={styles.note}>
          보유 수량과 평단가는 AI로 보내지 않습니다. 체크는 감시 종목에 넣을지만 정하고, 보유 내역은
          항상 전부 저장됩니다.
        </p>
        {error ? <ApiErrorNotice error={error} title="올리지 못했습니다" /> : null}
      </div>
    </Dialog>
  );
}
