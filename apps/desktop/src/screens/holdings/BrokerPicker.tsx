import { useState } from 'react';
import { toApiError, type ApiError } from '../../api/errors';
import { useApi } from '../../api/services';
import type { BrokerOut } from '../../api/types';
import { BrokerChip, Button } from '../../design-system';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import { Field } from '../common/Field';
import form from '../common/form.module.css';
import styles from './holdings.module.css';

export interface BrokerPickerProps {
  brokers: BrokerOut[];
  value: string;
  onChange: (id: string) => void;
  /** 증권사를 새로 등록했다(목록을 다시 받아야 한다). */
  onAdded: (broker: BrokerOut) => void;
  error?: string;
}

/** 증권사 고르기: 타이핑 없이 클릭(색 점 + 이름). 처음 보는 증권사는 [증권사 추가]로 이름을 한 번 등록한다. */
export function BrokerPicker({ brokers, value, onChange, onAdded, error }: BrokerPickerProps) {
  const api = useApi();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<ApiError | null>(null);

  async function add() {
    const trimmed = name.trim();
    if (!trimmed) {
      setFailed(null);
      return;
    }
    setBusy(true);
    setFailed(null);
    try {
      const made = await api.request<BrokerOut>('/brokers', {
        method: 'POST',
        body: { name: trimmed },
      });
      onAdded(made);
      onChange(made.id);
      setName('');
      setAdding(false);
    } catch (e) {
      setFailed(toApiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.stack}>
      <div className={styles.brokerRow} role="radiogroup" aria-label="증권사">
        {brokers.map((b) => (
          <label key={b.id} className={form.choice}>
            <input
              type="radio"
              name="broker"
              checked={value === b.id}
              onChange={() => onChange(b.id)}
            />
            <BrokerChip id={b.id} color={b.color}>
              {b.name}
            </BrokerChip>
          </label>
        ))}
        {adding ? null : (
          <Button size="sm" variant="quiet" onClick={() => setAdding(true)}>
            증권사 추가
          </Button>
        )}
      </div>
      {error ? <span className={form.error}>{error}</span> : null}
      {adding ? (
        <div className={styles.addBroker}>
          <Field label="증권사 이름" hint="한 번 등록하면 다음부터 클릭으로 고릅니다.">
            {(control) => (
              <input
                {...control}
                className={form.control}
                autoComplete="off"
                maxLength={20}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void add();
                  }
                }}
              />
            )}
          </Field>
          <div className={styles.actions}>
            <Button size="sm" busy={busy} onClick={() => void add()}>
              추가
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setAdding(false)}>
              취소
            </Button>
          </div>
          {failed ? <ApiErrorNotice error={failed} /> : null}
        </div>
      ) : null}
    </div>
  );
}
