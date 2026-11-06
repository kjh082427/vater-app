import { useState } from 'react';
import { toApiError, type ApiError } from '../../api/errors';
import { useApi } from '../../api/services';
import { useResource } from '../../api/useResource';
import type { BrokerOut, ConnectionOut, HoldingOut, SymbolOut, WatchItem } from '../../api/types';
import { BrokerChip, Button, Dialog, formatPrice, formatQuantity } from '../../design-system';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import { Field } from '../common/Field';
import form from '../common/form.module.css';
import { currencyOf, StockName } from '../common/quotes';
import { SymbolSearch } from '../common/SymbolSearch';
import { withObjectParticle } from '../common/text';
import { formatDayTime } from '../common/time';
import { BrokerPicker } from './BrokerPicker';
import { CsvImport } from './CsvImport';
import styles from './holdings.module.css';

interface Draft {
  stock: Pick<SymbolOut, 'market' | 'code' | 'name'> | null;
  brokerId: string;
  quantity: string;
  avgPrice: string;
  /** 수정 중이면 종목과 증권사는 고정이다. */
  editing: boolean;
}
const EMPTY: Draft = { stock: null, brokerId: '', quantity: '', avgPrice: '', editing: false };

/** 쉼표를 빼고 0보다 큰 십진수 문자열이면 그대로, 아니면 null. */
function positive(text: string): string | null {
  const t = text.trim().replace(/,/g, '');
  return /^\d+(\.\d+)?$/.test(t) && Number(t) > 0 ? t : null;
}

/** 이 증권사는 API로 연결되어 있지 않아 직접 입력할 수 있다(스펙 5장). */
export function manualBrokers(brokers: BrokerOut[], connections: ConnectionOut[]): BrokerOut[] {
  return brokers.filter(
    (b) => !connections.some((c) => c.broker_id === b.id && c.status !== 'disconnected'),
  );
}

export interface ManualDialogProps {
  onClose: () => void;
  /** 수동 입력을 저장·삭제했다(보유 내역이 바뀌었다). */
  onChanged: () => void;
  /** CSV를 올렸다. 그 증권사로 업로드 확인 창을 연다(스펙 14장). */
  onCsvDone: (brokerId: string) => void;
}

type Stock = NonNullable<Draft['stock']>;

/**
 * 보유 내역 직접 입력(스펙 5장, 14장): 종목 검색 → 증권사 클릭 → 수량 → 평균 매수가(1주당), 네 가지 모두 필수.
 * 수정·삭제, "직접 입력" 표시와 입력 날짜. [파일로 가져오기]는 CSV(CsvImport).
 * 수동 입력은 감시 종목을 바꾸지 않는다. 새로 넣은 종목이 감시 중이 아니면 저장 뒤에 감시 종목에도 넣을지 묻는다
 * (21장 4번, 묻고 사용자가 고를 때만 추가). 보유 값은 이 화면 밖으로(특히 AI로) 나가지 않는다.
 */
export function ManualDialog({ onClose, onChanged, onCsvDone }: ManualDialogProps) {
  const api = useApi();
  const brokers = useResource<BrokerOut[]>('/brokers');
  const connections = useResource<ConnectionOut[]>('/connections');
  const holdings = useResource<HoldingOut[]>('/holdings');
  const [csv, setCsv] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  // 저장한 새 종목이 감시 중이 아닐 때 묻는 중인 종목, 그리고 추가 결과 문구
  const [asking, setAsking] = useState<Stock | null>(null);
  const [watchBusy, setWatchBusy] = useState(false);
  const [watched, setWatched] = useState<string | null>(null);
  const choices = manualBrokers(brokers.data ?? [], connections.data ?? []);
  const brokerOf = (id: string) => brokers.data?.find((b) => b.id === id);
  const saved = (holdings.data ?? []).filter((h) => h.source !== 'api' && h.market !== null);
  const set = (changes: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...changes }));
    setErrors({});
  };
  const currency = draft.stock ? currencyOf(draft.stock.market) : null;
  const holdKey = (h: HoldingOut) => `${h.broker_id}:${h.market}:${h.code}`;

  async function save() {
    const found: Record<string, string> = {};
    const quantity = positive(draft.quantity);
    const avg = positive(draft.avgPrice);
    if (!draft.stock) found.stock = '종목을 고르세요.';
    if (!draft.brokerId) found.broker = '증권사를 고르세요.';
    if (draft.quantity.trim() === '') found.quantity = '수량을 입력하세요.';
    else if (!quantity) found.quantity = '수량은 0보다 큰 숫자여야 합니다.';
    else if (draft.stock?.market === 'KR' && !/^\d+$/.test(quantity)) {
      found.quantity = '국내 종목 수량은 정수여야 합니다.';
    }
    if (draft.avgPrice.trim() === '') found.avg = '평균 매수가를 입력하세요.';
    else if (!avg) found.avg = '평균 매수가는 0보다 큰 숫자여야 합니다.';
    setErrors(found);
    if (Object.keys(found).length > 0 || !draft.stock || !quantity || !avg) return;
    setBusy(true);
    setFailed(null);
    try {
      await api.request('/holdings/manual', {
        method: 'PUT',
        body: {
          broker_id: draft.brokerId,
          market: draft.stock.market,
          code: draft.stock.code,
          quantity,
          avg_price: avg,
        },
      });
      const added = !draft.editing ? draft.stock : null;
      setDraft({ ...EMPTY, brokerId: draft.brokerId });
      setAsking(null);
      setWatched(null);
      holdings.reload();
      onChanged();
      if (added) await askToWatch(added);
    } catch (e) {
      setFailed(toApiError(e));
    } finally {
      setBusy(false);
    }
  }

  /** 이미 감시 중이면 묻지 않는다. 감시 목록을 읽지 못하면 묻지 않고 넘어간다(보유 저장은 이미 끝났다). */
  async function askToWatch(stock: Stock) {
    try {
      const list = await api.request<WatchItem[]>('/watchlist');
      if (!list.some((w) => w.market === stock.market && w.code === stock.code)) setAsking(stock);
    } catch {
      // 제안만 건너뛴다
    }
  }

  async function addWatch(stock: Stock) {
    setWatchBusy(true);
    setFailed(null);
    try {
      await api.request('/watchlist', {
        method: 'POST',
        body: { market: stock.market, code: stock.code },
      });
      setAsking(null);
      setWatched(`${withObjectParticle(stock.name)} 감시 종목에 추가했습니다.`);
    } catch (e) {
      setFailed(toApiError(e));
    } finally {
      setWatchBusy(false);
    }
  }

  async function remove(h: HoldingOut) {
    setFailed(null);
    try {
      await api.request('/holdings/manual', {
        method: 'DELETE',
        body: { broker_id: h.broker_id, market: h.market, code: h.code },
      });
      setConfirming(null);
      holdings.reload();
      onChanged();
    } catch (e) {
      setFailed(toApiError(e));
    }
  }

  function edit(h: HoldingOut) {
    setConfirming(null);
    setErrors({});
    setDraft({
      stock: { market: h.market ?? 'KR', code: h.code, name: h.name },
      brokerId: h.broker_id,
      quantity: h.quantity,
      avgPrice: h.avg_price === null ? '' : String(h.avg_price),
      editing: true,
    });
  }

  return (
    <Dialog
      open
      wide={csv}
      title="보유 내역 직접 입력"
      onClose={onClose}
      footer={<Button onClick={onClose}>닫기</Button>}
    >
      <div className={styles.stack}>
        <p className={styles.note}>
          여기는 보유 내역(수량과 평균 매수가)을 넣는 곳입니다. 감시 종목을 추가하려면 감시·알림
          화면에서 종목을 검색하세요. 직접 입력한 보유 내역은 이 PC에만 저장되고, 증권사 갱신이
          덮어쓰지 않습니다. 보유 수량과 평단가는 AI로 보내지 않습니다.
        </p>
        {csv ? (
          <>
            <CsvImport
              brokers={choices}
              holdings={holdings.data}
              onBrokersChanged={brokers.reload}
              onDone={(brokerId) => {
                holdings.reload();
                onCsvDone(brokerId);
              }}
            />
            <div>
              <Button size="sm" variant="quiet" onClick={() => setCsv(false)}>
                한 종목씩 입력으로 돌아가기
              </Button>
            </div>
          </>
        ) : (
          <form
            className={styles.form}
            noValidate
            aria-label="보유 종목 입력"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {draft.stock ? (
              <div className={styles.picked}>
                <StockName
                  market={draft.stock.market}
                  name={draft.stock.name}
                  code={draft.stock.code}
                />
                {draft.editing ? null : (
                  <Button size="sm" variant="quiet" onClick={() => set({ stock: null })}>
                    바꾸기
                  </Button>
                )}
              </div>
            ) : (
              <div>
                <SymbolSearch
                  actionLabel="선택"
                  onPick={(s) =>
                    set({ stock: { market: s.market as 'KR' | 'US', code: s.code, name: s.name } })
                  }
                />
                {errors.stock ? <span className={form.error}>{errors.stock}</span> : null}
              </div>
            )}
            {draft.editing ? (
              <p className={styles.note}>
                {`증권사: ${brokerOf(draft.brokerId)?.name ?? draft.brokerId}`}
              </p>
            ) : (
              <BrokerPicker
                brokers={choices}
                value={draft.brokerId}
                onChange={(brokerId) => set({ brokerId })}
                onAdded={() => brokers.reload()}
                error={errors.broker}
              />
            )}
            <div className={styles.inline}>
              <Field label="수량" error={errors.quantity}>
                {(control) => (
                  <input
                    {...control}
                    className={`${form.control} vt-num`}
                    inputMode="decimal"
                    autoComplete="off"
                    value={draft.quantity}
                    onChange={(e) => set({ quantity: e.target.value })}
                  />
                )}
              </Field>
              <Field
                label={`평균 매수가(1주당${currency === 'USD' ? ', 달러' : currency === 'KRW' ? ', 원' : ''})`}
                error={errors.avg}
              >
                {(control) => (
                  <input
                    {...control}
                    className={`${form.control} vt-num`}
                    inputMode="decimal"
                    autoComplete="off"
                    value={draft.avgPrice}
                    onChange={(e) => set({ avgPrice: e.target.value })}
                  />
                )}
              </Field>
            </div>
            {failed ? <ApiErrorNotice error={failed} title="저장하지 못했습니다" /> : null}
            <div className={styles.actions}>
              <Button type="submit" variant="primary" busy={busy}>
                저장
              </Button>
              {draft.editing ? <Button onClick={() => setDraft(EMPTY)}>수정 취소</Button> : null}
              <Button onClick={() => setCsv(true)}>파일로 가져오기</Button>
            </div>
          </form>
        )}
        {asking && !csv ? (
          <div role="group" aria-label="감시 종목에도 추가할까요?" className={styles.ask}>
            <p className={styles.note}>
              {`${withObjectParticle(asking.name)} 감시 종목에도 추가할까요? 감시 종목은 시세 알림과 브리핑에 쓰이고, 종목 이름은 브리핑 작성 때 AI로 전송됩니다(보유 여부와 수량은 보내지 않습니다).`}
            </p>
            <div className={styles.actions}>
              <Button variant="primary" busy={watchBusy} onClick={() => void addWatch(asking)}>
                감시 종목에 추가
              </Button>
              <Button onClick={() => setAsking(null)}>추가 안 함</Button>
            </div>
          </div>
        ) : null}
        {watched && !csv ? (
          <p role="status" className={styles.note}>
            {watched}
          </p>
        ) : null}
        {saved.length > 0 && !csv ? (
          <ul className={styles.list} aria-label="직접 입력한 보유">
            {saved.map((h) => {
              const b = brokerOf(h.broker_id);
              const key = holdKey(h);
              const cur = currencyOf(h.market ?? 'KR');
              return (
                <li key={key} className={styles.item}>
                  <span className={styles.itemMain}>
                    <b className={styles.brokerName}>{h.name}</b>
                    <BrokerChip id={h.broker_id} color={b?.color ?? '#7f8698'}>
                      {b?.name ?? h.broker_id}
                    </BrokerChip>
                    <span className="vt-num">{`${formatQuantity(h.quantity, h.market ?? 'KR')}주`}</span>
                    <span className="vt-num">{`평단가 ${h.avg_price === null ? '—' : formatPrice(h.avg_price, cur)}`}</span>
                    <span className={styles.meta}>
                      {`${h.source === 'csv' ? 'CSV로 가져옴' : '직접 입력'} · ${formatDayTime(h.updated_at)}`}
                    </span>
                  </span>
                  {confirming === key ? (
                    <span className={styles.itemActions}>
                      <span
                        className={styles.meta}
                      >{`${withObjectParticle(h.name)} 지울까요?`}</span>
                      <Button size="sm" onClick={() => void remove(h)}>
                        지우기
                      </Button>
                      <Button size="sm" variant="quiet" onClick={() => setConfirming(null)}>
                        취소
                      </Button>
                    </span>
                  ) : (
                    <span className={styles.itemActions}>
                      <Button
                        size="sm"
                        variant="quiet"
                        aria-label={`${h.name} 수정`}
                        onClick={() => edit(h)}
                      >
                        수정
                      </Button>
                      <Button
                        size="sm"
                        variant="quiet"
                        aria-label={`${h.name} 삭제`}
                        onClick={() => setConfirming(key)}
                      >
                        삭제
                      </Button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </Dialog>
  );
}
