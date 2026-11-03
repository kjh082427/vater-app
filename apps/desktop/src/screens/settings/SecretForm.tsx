import { useState, type FormEvent } from 'react';
import { toApiError, type ApiError } from '../../api/errors';
import { useApi } from '../../api/services';
import { Button } from '../../design-system';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import { Field } from '../common/Field';
import form from '../common/form.module.css';
import styles from './settings.module.css';

export interface SecretField {
  /** 사이드카 비밀키 이름(PUT /secrets/{name}). */
  name: string;
  label: string;
  /** 키는 password(기본), 서버 주소 같은 것은 text. */
  kind?: 'password' | 'text';
}

export interface SecretFormProps {
  fields: SecretField[];
  /** GET /secrets: 이름 → 저장되어 있는지(값은 오지 않는다). */
  status: Record<string, boolean> | undefined;
  /** 저장이 끝난 뒤. Promise면 끝날 때까지 버튼이 진행 중으로 남는다(예: 저장하고 연결 테스트). */
  onSaved: () => void | Promise<void>;
  label?: string;
  /** 칸이 모두 비어도 onSaved를 부른다(이미 저장된 키로 시험만 할 때). */
  allowEmpty?: boolean;
  /** 비운 채 눌렀을 때의 안내. */
  emptyMessage?: string;
}

/**
 * 쓰기 전용 비밀키 입력(스펙 2-3: 읽기 API가 없음). 저장하면 칸을 비우고 "저장됨"만 보인다.
 * 값은 상태에만 잠깐 있고, 화면·로그·오류 문구 어디에도 다시 나오지 않는다. 빈 칸은 보내지 않는다.
 */
export function SecretForm({
  fields,
  status,
  onSaved,
  label = '키 저장',
  allowEmpty = false,
  emptyMessage = '바꿀 값을 입력하세요.',
}: SecretFormProps) {
  const api = useApi();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    const entries = fields
      .map((f) => [f.name, (values[f.name] ?? '').trim()] as const)
      .filter(([, v]) => v !== '');
    setSaved(false);
    setError(null);
    if (entries.length === 0 && !allowEmpty) {
      setEmpty(true);
      return;
    }
    setEmpty(false);
    setBusy(true);
    try {
      for (const [name, value] of entries) {
        await api.request(`/secrets/${name}`, { method: 'PUT', body: { value } });
        // 저장된 값은 바로 지운다: 다음 항목이 실패해도 키가 칸(메모리·DOM)에 남지 않게
        setValues((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== name)));
      }
      if (entries.length > 0) setSaved(true);
      await onSaved();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.fields} onSubmit={save} noValidate aria-label={label}>
      <p className={styles.status}>
        {fields.map((f) => (
          <span key={f.name}>{`${f.label} ${status?.[f.name] ? '저장됨' : '없음'}`}</span>
        ))}
      </p>
      {fields.map((f) => (
        <Field key={f.name} label={f.label}>
          {(control) => (
            <input
              {...control}
              className={form.control}
              type={f.kind === 'text' ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              placeholder={status?.[f.name] ? '저장됨 · 바꾸려면 새 값을 입력' : ''}
              value={values[f.name] ?? ''}
              onChange={(e) => {
                const value = e.target.value;
                setValues((prev) => ({ ...prev, [f.name]: value }));
                setSaved(false);
              }}
            />
          )}
        </Field>
      ))}
      {empty ? <span className={form.error}>{emptyMessage}</span> : null}
      {error ? <ApiErrorNotice error={error} /> : null}
      <div className={form.actions}>
        <Button type="submit" busy={busy}>
          {busy ? '저장 중…' : label}
        </Button>
        {saved ? (
          <span role="status" className={styles.ok}>
            저장됨
          </span>
        ) : null}
      </div>
    </form>
  );
}
