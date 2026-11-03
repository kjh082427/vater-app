import { useState } from 'react';
import { toApiError, type ApiError } from '../../api/errors';
import { useApi } from '../../api/services';
import type { CatalogOut, CloudTestOut } from '../../api/types';
import { Button } from '../../design-system';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import { Field } from '../common/Field';
import form from '../common/form.module.css';
import { SecretForm } from './SecretForm';
import styles from './settings.module.css';
import { str, type Settings } from './useSettings';

/** 클라우드 AI: 제공자, 쓰기 전용 키(호환 서버는 주소도), 모델 이름, 연결 테스트. */
export function CloudSettings({
  catalog,
  secrets,
  onSecretsSaved,
  settings,
  save,
  showModels = true,
}: {
  catalog: CatalogOut | undefined;
  secrets: Record<string, boolean> | undefined;
  onSecretsSaved: () => void;
  settings: Settings | undefined;
  save: (changes: Settings) => Promise<boolean>;
  showModels?: boolean;
}) {
  const api = useApi();
  const providerId = str(settings, 'llm.cloud_provider', 'google');
  const provider = catalog?.cloud[providerId];
  const [deep, setDeep] = useState<string | null>(null);
  const [quick, setQuick] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<CloudTestOut | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [modelsSaved, setModelsSaved] = useState(false);

  async function test() {
    setTesting(true);
    setError(null);
    setResult(null);
    try {
      setResult(
        await api.request<CloudTestOut>('/settings/llm/test', {
          method: 'POST',
          query: { provider: providerId },
        }),
      );
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setTesting(false);
    }
  }

  async function saveModels() {
    setModelsSaved(false);
    const ok = await save({
      'llm.cloud_deep_model': (deep ?? str(settings, 'llm.cloud_deep_model')).trim(),
      'llm.cloud_quick_model': (quick ?? str(settings, 'llm.cloud_quick_model')).trim(),
    });
    setModelsSaved(ok);
  }

  return (
    <div className={styles.body}>
      <Field label="제공자">
        {(control) => (
          <select
            {...control}
            className={form.control}
            value={providerId}
            disabled={!catalog || !settings}
            onChange={(e) => {
              setResult(null);
              setError(null);
              void save({ 'llm.cloud_provider': e.target.value });
            }}
          >
            {Object.entries(catalog?.cloud ?? {}).map(([id, p]) => (
              <option key={id} value={id}>
                {p.free_tier ? `${p.label} (무료 등급 있음)` : p.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      {provider ? (
        <SecretForm
          key={providerId}
          fields={[
            { name: provider.secret, label: `${provider.label} 키` },
            ...(provider.base_url_secret
              ? [{ name: provider.base_url_secret, label: '서버 주소', kind: 'text' as const }]
              : []),
          ]}
          status={secrets}
          onSaved={onSecretsSaved}
        />
      ) : null}
      {showModels && provider ? (
        <div className={form.row}>
          <Field
            label="깊은 분석 모델"
            hint={provider.deep ? `비우면 ${provider.deep}` : '모델 이름을 넣으세요.'}
          >
            {(control) => (
              <input
                {...control}
                className={form.control}
                value={deep ?? str(settings, 'llm.cloud_deep_model')}
                onChange={(e) => {
                  setDeep(e.target.value);
                  setModelsSaved(false);
                }}
              />
            )}
          </Field>
          <Field
            label="빠른 모델"
            hint={provider.quick ? `비우면 ${provider.quick}` : '모델 이름을 넣으세요.'}
          >
            {(control) => (
              <input
                {...control}
                className={form.control}
                value={quick ?? str(settings, 'llm.cloud_quick_model')}
                onChange={(e) => {
                  setQuick(e.target.value);
                  setModelsSaved(false);
                }}
              />
            )}
          </Field>
          <div className={form.actions}>
            <Button onClick={saveModels}>모델 저장</Button>
            {modelsSaved ? <span className={styles.ok}>모델 저장됨</span> : null}
          </div>
        </div>
      ) : null}
      <div className={form.actions}>
        <Button busy={testing} disabled={!provider} onClick={test}>
          {testing ? '확인 중…' : '연결 테스트'}
        </Button>
        {result ? (
          <span
            role="status"
            className={styles.ok}
          >{`연결됨: 모델 ${result.model_count}개를 쓸 수 있습니다.`}</span>
        ) : null}
      </div>
      {result && !result.defaults_available ? (
        <p className={styles.warn}>
          기본 모델을 이 키로 쓸 수 없습니다. 위에 쓸 모델 이름을 직접 넣으세요.
        </p>
      ) : null}
      {error ? <ApiErrorNotice error={error} /> : null}
    </div>
  );
}
