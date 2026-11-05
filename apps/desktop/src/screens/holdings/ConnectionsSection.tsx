import { useState, type FormEvent } from 'react';
import { toApiError, type ApiError } from '../../api/errors';
import { useApi } from '../../api/services';
import { useResource } from '../../api/useResource';
import type { BrokerOut, ConnectionOut } from '../../api/types';
import { Banner, BrokerChip, Button, Dialog } from '../../design-system';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import { Field } from '../common/Field';
import form from '../common/form.module.css';
import { SelectField } from '../common/SelectField';
import { formatDayTime } from '../common/time';
import styles from './holdings.module.css';
import { maskOf } from './mask';

const STATUS_TEXT = { ok: '연결됨', lost: '연결 끊김', disconnected: '연결 해제됨' } as const;

interface Draft {
  brokerId: string;
  account: string;
  appKey: string;
  appSecret: string;
}

/** 한투는 종합계좌(뒤 2자리 01) 10자리만 받는다(스펙 1장). 틀리면 이유, 맞으면 null. */
function accountProblem(account: string): string | null {
  const digits = account.replace(/\D/g, '');
  if (digits.length !== 10) return '계좌번호 10자리를 입력하세요.';
  if (!digits.endsWith('01'))
    return '종합계좌(뒤 2자리 01)만 연결할 수 있습니다. 연금 등 다른 계좌는 v2에서 받지 않습니다.';
  return null;
}

function ConnectForm({
  brokers,
  connections,
  replaces,
  onDone,
  onCancel,
}: {
  brokers: BrokerOut[];
  connections: ConnectionOut[];
  /** [다시 연결]이 고른 옛 연결. 있으면 증권사는 고정이다. */
  replaces: ConnectionOut | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const api = useApi();
  const apiBrokers = brokers.filter((b) => b.kind === 'api');
  const [draft, setDraft] = useState<Draft>({
    brokerId: replaces?.broker_id ?? apiBrokers[0]?.id ?? 'kis',
    account: '',
    appKey: '',
    appSecret: '',
  });
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<ConnectionOut | null>(null);
  const set = (changes: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...changes }));
    setProblem(null);
  };
  const isKis = draft.brokerId === 'kis';
  const broker = brokers.find((b) => b.id === draft.brokerId);

  async function post(replacesId: number | null) {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = isKis
        ? { broker_id: 'kis', account: draft.account.replace(/\D/g, '') }
        : {
            broker_id: draft.brokerId,
            app_key: draft.appKey.trim(),
            app_secret: draft.appSecret.trim(),
          };
      if (replacesId !== null) body.replaces = replacesId;
      await api.request('/connections', { method: 'POST', body });
      onDone(); // 키가 든 이 칸은 닫히며 사라진다
    } catch (e) {
      setError(toApiError(e));
      setAsk(null);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const bad = isKis
      ? accountProblem(draft.account)
      : draft.appKey.trim() === '' || draft.appSecret.trim() === ''
        ? '앱키와 앱시크릿을 모두 입력하세요.'
        : null;
    setProblem(bad);
    if (bad) return;
    if (replaces) return post(replaces.id);
    // 해제하면 계좌번호도 지우므로, 같은 구분의 해제 연결이 있으면 이어 붙일지 묻는다(스펙 1-1)
    const mask = await maskOf(draft.brokerId, draft.account, draft.appKey);
    const same = connections.find(
      (c) =>
        c.broker_id === draft.brokerId && c.status === 'disconnected' && c.account_mask === mask,
    );
    if (same) setAsk(same);
    else await post(null);
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate aria-label="증권사 연결 추가">
      {replaces ? (
        <p className={styles.note}>
          {`${broker?.name ?? ''} 연결을 다시 만듭니다. 새 연결의 테스트와 첫 조회가 성공하면 이전 내역을 이 연결로 바꾸고, 실패하면 이전 내역이 그대로 남습니다.`}
        </p>
      ) : (
        <SelectField
          label="증권사"
          value={draft.brokerId}
          onChange={(brokerId) => set({ brokerId })}
          options={apiBrokers.map((b) => ({ value: b.id, label: b.name }))}
        />
      )}
      {isKis ? (
        <Field
          label="계좌번호"
          hint="종합계좌(뒤 2자리 01) 10자리. 앱키와 시크릿은 위 한국투자증권 칸에 저장합니다."
          error={problem ?? undefined}
        >
          {(control) => (
            <input
              {...control}
              className={`${form.control} vt-num`}
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              value={draft.account}
              onChange={(e) => set({ account: e.target.value })}
            />
          )}
        </Field>
      ) : (
        <>
          <Field label="앱키" error={problem ?? undefined}>
            {(control) => (
              <input
                {...control}
                className={form.control}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={draft.appKey}
                onChange={(e) => set({ appKey: e.target.value })}
              />
            )}
          </Field>
          <Field label="앱시크릿">
            {(control) => (
              <input
                {...control}
                className={form.control}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={draft.appSecret}
                onChange={(e) => set({ appSecret: e.target.value })}
              />
            )}
          </Field>
          <span className={form.hint}>
            이 증권사는 계좌번호를 받지 않습니다. 연결 목록에는 앱키로 만든 구분(키 ab12)이
            보입니다.
          </span>
        </>
      )}
      {draft.brokerId === 'meritz' ? (
        <p className={styles.note}>
          메리츠는 모든 요청에 이 PC의 MAC 주소를 함께 보내야 합니다. 앱이 PC에서 읽어 메리츠에만
          보내고, 다른 곳에는 보내지 않습니다.
        </p>
      ) : null}
      {error ? <ApiErrorNotice error={error} title="연결하지 못했습니다" /> : null}
      <div className={styles.actions}>
        <Button type="submit" variant="primary" busy={busy}>
          {busy ? '연결 확인 중…' : '연결'}
        </Button>
        <Button onClick={onCancel}>취소</Button>
      </div>
      <Dialog
        open={ask !== null}
        title="이전 내역을 이 연결로 바꿀까요?"
        onClose={() => setAsk(null)}
        footer={
          <>
            <Button onClick={() => setAsk(null)}>취소</Button>
            <Button onClick={() => void post(null)}>새로 추가</Button>
            <Button variant="primary" onClick={() => ask && void post(ask.id)}>
              바꾸기
            </Button>
          </>
        }
      >
        <p className={styles.dialogBody}>
          {`${broker?.name ?? ''} ${ask?.account_mask ?? ''} 연결이 해제되어 있고, 그 내역이 남아 있습니다. 같은 계좌라면 이전 내역을 새 연결로 바꿉니다. 새 연결의 첫 조회가 성공해야 이전 내역을 지웁니다.`}
        </p>
      </Dialog>
    </form>
  );
}

function ReleaseDialog({
  conn,
  broker,
  onClose,
  onDone,
}: {
  conn: ConnectionOut | null;
  broker: BrokerOut | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const api = useApi();
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const name = broker?.name ?? '';

  async function release(deleteData: boolean) {
    if (!conn) return;
    setBusy(true);
    setError(null);
    try {
      await api.request(`/connections/${conn.id}`, {
        method: 'DELETE',
        query: { delete_data: deleteData },
      });
      onDone();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={conn !== null}
      title={`${name} 연결 해제`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button busy={busy} onClick={() => void release(true)}>
            데이터 삭제
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void release(false)}>
            데이터 유지
          </Button>
        </>
      }
    >
      <div className={styles.dialogBody}>
        <p>{`${name} 연결을 해제합니다. 이 증권사의 기존 데이터를 삭제할까요?`}</p>
        <p>
          삭제하면 이 증권사 계좌의 보유 내역(수량, 평단가)을 앱에서 모두 지우고 종목 합계와 칩을
          바로 다시 계산합니다. 자산 추이의 지난 기록과 감시 종목·규칙은 남습니다.
        </p>
        <p>
          삭제하지 않으면 보유 내역은 &quot;연결 해제됨&quot; 표시와 함께 합계에 계속 들어갑니다.
        </p>
        <p>키는 어느 쪽이든 지웁니다.</p>
        {error ? <ApiErrorNotice error={error} /> : null}
      </div>
    </Dialog>
  );
}

/** 설정 > 증권사 연결(스펙 1장): 목록, 추가, 해제, 끊김 처리. 키는 쓰기 전용이라 다시 보이지 않는다. */
export function ConnectionsSection() {
  const api = useApi();
  const conns = useResource<ConnectionOut[]>('/connections');
  const brokers = useResource<BrokerOut[]>('/brokers');
  const [adding, setAdding] = useState<{ replaces: ConnectionOut | null } | null>(null);
  const [releasing, setReleasing] = useState<ConnectionOut | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const list = conns.data ?? [];
  const brokerOf = (id: string) => brokers.data?.find((b) => b.id === id);
  const nameOf = (id: string) => brokerOf(id)?.name ?? id;

  async function deleteData(brokerId: string) {
    setError(null);
    try {
      await api.request(`/brokers/${brokerId}/data`, { method: 'DELETE' });
      conns.reload();
    } catch (e) {
      setError(toApiError(e));
    }
  }

  return (
    <div className={styles.stack}>
      {conns.error ? (
        <ApiErrorNotice
          error={conns.error}
          title="연결 목록을 불러오지 못했습니다"
          onRetry={conns.reload}
        />
      ) : null}
      {error ? <ApiErrorNotice error={error} title="데이터를 지우지 못했습니다" /> : null}
      {conns.data && list.length === 0 ? (
        <p className={styles.empty}>
          연결한 증권사가 없습니다. 증권사를 연결하면 보유 종목과 평단가를 불러와 감시 종목에 올릴
          수 있습니다. 연결하지 않아도 [보유 종목 직접 추가]로 입력할 수 있습니다.
        </p>
      ) : null}
      {list.length > 0 ? (
        <ul className={styles.list} aria-label="연결한 증권사">
          {list.map((c) => {
            const b = brokerOf(c.broker_id);
            return (
              <li key={c.id} className={styles.item}>
                <span className={styles.itemMain}>
                  <BrokerChip id={c.broker_id} color={b?.color ?? '#7f8698'}>
                    <span className={styles.brokerName}>{nameOf(c.broker_id)}</span>
                  </BrokerChip>
                  <span className="vt-num">{c.account_mask}</span>
                  <span>{STATUS_TEXT[c.status]}</span>
                  <span className={styles.meta}>
                    {c.last_synced_at
                      ? `마지막 갱신 ${formatDayTime(c.last_synced_at)}`
                      : '아직 갱신 전'}
                  </span>
                </span>
                <span className={styles.itemActions}>
                  {c.status === 'ok' ? (
                    <Button
                      size="sm"
                      aria-label={`${nameOf(c.broker_id)} ${c.account_mask} 연결 해제`}
                      onClick={() => setReleasing(c)}
                    >
                      해제
                    </Button>
                  ) : null}
                  {c.status === 'disconnected' ? (
                    <>
                      <Button
                        size="sm"
                        aria-label={`${nameOf(c.broker_id)} ${c.account_mask} 다시 연결`}
                        onClick={() => setAdding({ replaces: c })}
                      >
                        다시 연결
                      </Button>
                      <Button size="sm" onClick={() => void deleteData(c.broker_id)}>
                        데이터 삭제
                      </Button>
                    </>
                  ) : null}
                </span>
                {c.status === 'lost' ? (
                  <Banner
                    className={styles.itemBanner}
                    tone="caution"
                    title={`${nameOf(c.broker_id)} 연결이 끊겼습니다`}
                    action={
                      <>
                        <Button size="sm" onClick={() => setAdding({ replaces: c })}>
                          다시 연결
                        </Button>
                        <Button size="sm" onClick={() => void deleteData(c.broker_id)}>
                          데이터 삭제
                        </Button>
                      </>
                    }
                  >
                    {`저장된 수량은 마지막 갱신 ${c.last_synced_at ? formatDayTime(c.last_synced_at) : '시각을 알 수 없음'}까지 유지됩니다. ${c.last_error ?? ''}`}
                  </Banner>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {adding ? (
        <ConnectForm
          key={adding.replaces?.id ?? 'new'}
          brokers={brokers.data ?? []}
          connections={list}
          replaces={adding.replaces}
          onCancel={() => setAdding(null)}
          onDone={() => {
            setAdding(null);
            conns.reload();
          }}
        />
      ) : (
        <div className={styles.actions}>
          <Button onClick={() => setAdding({ replaces: null })}>연결 추가</Button>
        </div>
      )}
      <ReleaseDialog
        conn={releasing}
        broker={releasing ? brokerOf(releasing.broker_id) : undefined}
        onClose={() => setReleasing(null)}
        onDone={() => {
          setReleasing(null);
          conns.reload();
        }}
      />
    </div>
  );
}
