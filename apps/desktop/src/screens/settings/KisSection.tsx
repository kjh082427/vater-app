import { useState } from 'react';
import { toApiError, type ApiError } from '../../api/errors';
import { useApi } from '../../api/services';
import type { KisTestResult } from '../../api/types';
import { Button, formatWon, SegmentedControl } from '../../design-system';
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
    <div className={form.choices}>
      <span className={form.legend} aria-hidden="true">
        서버
      </span>
      <SegmentedControl
        label="서버"
        value={settings === undefined ? ('' as 'prod') : server}
        options={(['prod', 'vps'] as const).map((value) => ({
          value,
          label: SERVER_LABEL[value] ?? value,
          disabled: settings === undefined,
        }))}
        onChange={(value) => void save({ 'kis.server': value })}
      />
    </div>
  );
}

/**
 * 연결 테스트(POST /settings/kis/test): 토큰을 받고 삼성전자 현재가를 조회해 본다.
 * 저장된 키와 서버로 시험하므로, 키나 서버가 바뀌면 reset으로 이전 결과를 지운다.
 */
export function useKisTest() {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<KisTestResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function run(): Promise<boolean> {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const out = await api.request<KisTestResult>('/settings/kis/test', { method: 'POST' });
      setResult(out);
      return out.ok;
    } catch (e) {
      setError(toApiError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setResult(null);
    setError(null);
  }

  return { busy, result, error, run, reset };
}

export type KisTest = ReturnType<typeof useKisTest>;

/** 연결 테스트 결과: 성공은 서버와 삼성전자 현재가, 실패는 사이드카의 message와 hint 그대로. */
export function KisTestOutcome({ test }: { test: KisTest }) {
  return (
    <>
      {test.result ? (
        <span role="status" className={styles.ok}>
          {`연결됨: ${SERVER_LABEL[test.result.server] ?? test.result.server} 서버 · 삼성전자 현재가 ${formatWon(test.result.sample.price)}`}
        </span>
      ) : null}
      {test.error ? <ApiErrorNotice error={test.error} /> : null}
    </>
  );
}

/** [연결 테스트] 버튼과 결과(설정 화면). */
export function KisConnectionTest({ test }: { test: KisTest }) {
  return (
    <div className={styles.fields}>
      <div className={form.actions}>
        <Button busy={test.busy} onClick={() => void test.run()}>
          {test.busy ? '확인 중…' : '연결 테스트'}
        </Button>
      </div>
      <KisTestOutcome test={test} />
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
  const test = useKisTest();
  return (
    <div className={styles.body}>
      <SecretForm
        fields={KIS_FIELDS}
        status={secrets}
        onSaved={() => {
          test.reset();
          onSecretsSaved();
        }}
      />
      <KisServerChoice
        settings={settings}
        save={(changes) => {
          test.reset();
          return save(changes);
        }}
      />
      <KisConnectionTest test={test} />
    </div>
  );
}
