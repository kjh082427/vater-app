import { useState } from 'react';
import { toApiError, type ApiError } from '../../api/errors';
import { useApi } from '../../api/services';
import type { KisTestResult } from '../../api/types';
import { Button, formatWon } from '../../design-system';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import form from '../common/form.module.css';
import { SecretForm, type SecretField } from './SecretForm';
import styles from './settings.module.css';
import type { Settings } from './useSettings';

export const KIS_FIELDS: SecretField[] = [
  { name: 'KIS_APP_KEY', label: '앱키' },
  { name: 'KIS_APP_SECRET', label: '앱시크릿' },
  { name: 'KIS_HTS_ID', label: 'HTS ID' },
];

const SERVER_LABEL: Record<string, string> = { prod: '실전', vps: '모의' };

/** 실전/모의 서버 고르기(설정 kis.server). */
export function KisServerChoice({
  settings,
  save,
}: {
  settings: Settings | undefined;
  save: (changes: Settings) => Promise<boolean>;
}) {
  const server = settings?.['kis.server'] === 'vps' ? 'vps' : 'prod';
  return (
    <fieldset className={form.choices}>
      <legend className={form.legend}>서버</legend>
      {(['prod', 'vps'] as const).map((value) => (
        <label key={value} className={form.choice}>
          <input
            type="radio"
            name="kis-server"
            value={value}
            checked={settings !== undefined && server === value}
            disabled={settings === undefined}
            onChange={() => void save({ 'kis.server': value })}
          />
          {SERVER_LABEL[value]}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * 연결 테스트(POST /settings/kis/test): 토큰을 받고 삼성전자 현재가를 조회해 본다.
 * 성공하면 onResult(true). 실패는 사이드카의 message와 hint를 그대로.
 */
export function KisConnectionTest({ onResult }: { onResult?: (ok: boolean) => void }) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<KisTestResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const out = await api.request<KisTestResult>('/settings/kis/test', { method: 'POST' });
      setResult(out);
      onResult?.(out.ok);
    } catch (e) {
      setError(toApiError(e));
      onResult?.(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.fields}>
      <div className={form.actions}>
        <Button busy={busy} onClick={run}>
          {busy ? '확인 중…' : '연결 테스트'}
        </Button>
        {result ? (
          <span role="status" className={styles.ok}>
            {`연결됨: ${SERVER_LABEL[result.server] ?? result.server} 서버 · 삼성전자 현재가 ${formatWon(result.sample.price)}`}
          </span>
        ) : null}
      </div>
      {error ? <ApiErrorNotice error={error} /> : null}
    </div>
  );
}

/** 설정 > 한국투자증권: 쓰기 전용 키, 실전/모의, 연결 테스트. */
export function KisSettings({
  secrets,
  onSecretsSaved,
  settings,
  save,
}: {
  secrets: Record<string, boolean> | undefined;
  onSecretsSaved: () => void;
  settings: Settings | undefined;
  save: (changes: Settings) => Promise<boolean>;
}) {
  return (
    <div className={styles.body}>
      <SecretForm fields={KIS_FIELDS} status={secrets} onSaved={onSecretsSaved} />
      <KisServerChoice settings={settings} save={save} />
      <KisConnectionTest />
    </div>
  );
}
