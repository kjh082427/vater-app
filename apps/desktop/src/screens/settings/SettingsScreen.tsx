import { useEffect, useState } from 'react';
import { toApiError, type ApiError } from '../../api/errors';
import { useServices } from '../../api/services';
import { useResource } from '../../api/useResource';
import type { CatalogOut, Health } from '../../api/types';
import { Button, Section } from '../../design-system';
import { PRESET_LABEL } from '../../app/status';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import { Field } from '../common/Field';
import form from '../common/form.module.css';
import { ScreenHeader } from '../common/ScreenHeader';
import common from '../common/screen.module.css';
import { CloudSettings } from './CloudSection';
import { KisSettings } from './KisSection';
import { LocalSettings } from './LocalSection';
import styles from './settings.module.css';
import { str, useSettings, type Settings } from './useSettings';

const PRESET_HINT: Record<string, string> = {
  cloud: '빠른 단계와 깊은 분석 모두 클라우드 AI. 키가 필요합니다.',
  local: '모두 이 PC의 Ollama 모델. 인터넷과 키가 필요 없지만 느립니다.',
  mixed: '빠른 단계는 이 PC의 모델, 깊은 분석은 클라우드 AI.',
};

function BriefingSettings({
  settings,
  saveOrError,
}: {
  settings: Settings | undefined;
  saveOrError: (changes: Settings) => Promise<ApiError | null>;
}) {
  const [draft, setDraft] = useState<Settings>({});
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const value = (key: string) => (key in draft ? draft[key] : settings?.[key]);
  const set = (key: string, v: unknown) => {
    setDraft((prev) => ({ ...prev, [key]: v }));
    setSaved(false);
  };

  async function submit() {
    const changes: Settings = {};
    for (const m of ['kr', 'us']) {
      changes[`briefing.${m}.enabled`] = value(`briefing.${m}.enabled`) !== false;
      changes[`briefing.${m}.time`] = String(value(`briefing.${m}.time`) ?? '').trim();
    }
    const failed = await saveOrError(changes);
    setError(failed);
    setSaved(failed === null);
    if (failed === null) setDraft({});
  }

  return (
    <div className={styles.body}>
      {(['kr', 'us'] as const).map((m) => {
        const name = m === 'kr' ? '국내' : '미국';
        return (
          <div key={m} className={styles.row}>
            <label className={form.choice}>
              <input
                type="checkbox"
                checked={value(`briefing.${m}.enabled`) !== false}
                disabled={!settings}
                onChange={(e) => set(`briefing.${m}.enabled`, e.target.checked)}
              />
              {`${name} 브리핑 만들기`}
            </label>
            <Field
              label={`${name} 브리핑 시각`}
              hint={`한국 시간, 기본 ${m === 'kr' ? '16:00' : '07:00'}`}
            >
              {(control) => (
                <input
                  {...control}
                  className={`${form.control} vt-num`}
                  inputMode="numeric"
                  autoComplete="off"
                  disabled={!settings}
                  value={String(value(`briefing.${m}.time`) ?? '')}
                  onChange={(e) => set(`briefing.${m}.time`, e.target.value)}
                />
              )}
            </Field>
          </div>
        );
      })}
      {error ? <ApiErrorNotice error={error} /> : null}
      <div className={form.actions}>
        <Button disabled={!settings} onClick={submit}>
          브리핑 설정 저장
        </Button>
        {saved ? (
          <span role="status" className={styles.ok}>
            저장됨
          </span>
        ) : null}
      </div>
    </div>
  );
}

function GeneralSettings({
  settings,
  save,
}: {
  settings: Settings | undefined;
  save: (changes: Settings) => Promise<boolean>;
}) {
  const { platform } = useServices();
  const health = useResource<Health>('/health');
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const browser = platform.kind === 'browser';

  useEffect(() => {
    let alive = true;
    platform.getAutostart().then(
      (on) => {
        if (alive) setAutostart(on);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [platform]);

  async function changeAutostart(on: boolean) {
    setError(null);
    try {
      await platform.setAutostart(on);
      setAutostart(await platform.getAutostart());
    } catch (e) {
      setError(toApiError(e));
    }
  }

  return (
    <div className={styles.body}>
      <label className={form.choice}>
        <input
          type="checkbox"
          checked={autostart === true}
          disabled={autostart === null || browser}
          onChange={(e) => void changeAutostart(e.target.checked)}
        />
        부팅 시 자동 실행
      </label>
      {browser ? <span className={common.meta}>설치한 앱에서만 바꿀 수 있습니다.</span> : null}
      <label className={form.choice}>
        <input
          type="checkbox"
          checked={settings?.['general.close_to_tray'] !== false}
          disabled={!settings}
          onChange={(e) => void save({ 'general.close_to_tray': e.target.checked })}
        />
        창을 닫으면 트레이로 숨기기
      </label>
      {error ? <ApiErrorNotice error={error} /> : null}
      <dl className={styles.facts}>
        <dt>버전</dt>
        <dd className="vt-num">{health.data?.version ?? '—'}</dd>
      </dl>
    </div>
  );
}

/** 설정(스펙 9-2): 한국투자증권, AI 엔진, 분석 기본값, 브리핑, 일반. 비밀키는 쓰기 전용이다. */
export function SettingsScreen() {
  const settings = useSettings();
  const secrets = useResource<Record<string, boolean>>('/secrets');
  const catalog = useResource<CatalogOut>('/llm/catalog');
  const s = settings.data;
  const preset = str(s, 'llm.preset', 'cloud');

  return (
    <>
      <ScreenHeader
        title="설정"
        lede="키는 이 PC의 Windows 자격 증명 관리자에만 저장되고, 저장한 뒤에는 다시 보이지 않습니다."
      />
      {settings.error ? (
        <ApiErrorNotice error={settings.error} title="설정을 저장하지 못했습니다" />
      ) : null}
      {settings.loadError ? (
        <ApiErrorNotice
          error={settings.loadError}
          title="설정을 불러오지 못했습니다"
          onRetry={settings.reload}
        />
      ) : null}
      <div className={common.twoUp}>
        <div className={common.twoUpGrid}>
          <div className={common.column}>
            <Section title="한국투자증권">
              <KisSettings
                secrets={secrets.data}
                onSecretsSaved={secrets.reload}
                settings={s}
                save={settings.save}
              />
            </Section>
            <Section title="AI 엔진">
              <div className={styles.body}>
                <Field label="프리셋" hint={PRESET_HINT[preset]}>
                  {(control) => (
                    <select
                      {...control}
                      className={form.control}
                      value={preset}
                      disabled={!s}
                      onChange={(e) => void settings.save({ 'llm.preset': e.target.value })}
                    >
                      {Object.entries(PRESET_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                {catalog.error ? (
                  <ApiErrorNotice error={catalog.error} title="모델 목록을 불러오지 못했습니다" />
                ) : null}
                <Section title="클라우드 AI" headingLevel={3}>
                  <CloudSettings
                    catalog={catalog.data}
                    secrets={secrets.data}
                    onSecretsSaved={secrets.reload}
                    settings={s}
                    save={settings.save}
                  />
                </Section>
                <Section title="로컬 AI" headingLevel={3}>
                  <LocalSettings catalog={catalog.data} settings={s} save={settings.save} />
                </Section>
              </div>
            </Section>
          </div>
          <div className={common.column}>
            <Section title="분석 기본값">
              <div className={styles.body}>
                <Field
                  label="토론 라운드"
                  hint="강세·약세 토론과 리스크 토론을 몇 번 주고받을지. 늘리면 오래 걸립니다."
                >
                  {(control) => (
                    <select
                      {...control}
                      className={form.control}
                      value={String(s?.['analysis.debate_rounds'] ?? 1)}
                      disabled={!s}
                      onChange={(e) =>
                        void settings.save({ 'analysis.debate_rounds': Number(e.target.value) })
                      }
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>{`${n}회`}</option>
                      ))}
                    </select>
                  )}
                </Field>
              </div>
            </Section>
            <Section title="브리핑">
              <BriefingSettings settings={s} saveOrError={settings.saveOrError} />
            </Section>
            <Section title="일반">
              <GeneralSettings settings={s} save={settings.save} />
            </Section>
          </div>
        </div>
      </div>
    </>
  );
}
