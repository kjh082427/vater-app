import { useState } from 'react';
import { toApiError, type ApiError } from '../../api/errors';
import { useApi, useServices } from '../../api/services';
import { useResource } from '../../api/useResource';
import type { CatalogOut, HardwareOut, WatchItem } from '../../api/types';
import { Button, Disclaimer, SegmentedControl, Toggle } from '../../design-system';
import { navigate } from '../../app/router';
import { PRESET_LABEL } from '../../app/status';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import form from '../common/form.module.css';
import { StockName } from '../common/quotes';
import common from '../common/screen.module.css';
import { symbolKey, SymbolSearch } from '../common/SymbolSearch';
import { withObjectParticle } from '../common/text';
import { CloudSettings } from '../settings/CloudSection';
import { KIS_FIELDS, KisServerChoice, KisTestOutcome, useKisTest } from '../settings/KisSection';
import { LocalSettings } from '../settings/LocalSection';
import { SecretForm } from '../settings/SecretForm';
import { useSettings, type Settings } from '../settings/useSettings';
import styles from './welcome.module.css';

const STEPS = ['환영', '한투 연결', 'AI 엔진', '감시 종목', '완료'] as const;

type AiChoice = 'cloud' | 'local' | 'later';

function Intro() {
  return (
    <div className={styles.body}>
      <h2 className={styles.heading}>Vater를 소개합니다</h2>
      <p className={styles.text}>
        Vater는 한국투자증권 시세와 여러 AI 에이전트의 분석을 모아 판단을 돕는 보조 앱입니다. 몇
        분이면 설정이 끝납니다.
      </p>
      <ul className={styles.points}>
        <li>
          감시 종목의 조건이 맞으면 Windows 알림으로 알려 드립니다. 창을 닫아도 트레이에서 계속
          지켜봅니다.
        </li>
        <li>AI 에이전트들이 토론한 종목 분석 보고서와, 장이 끝난 뒤의 시장 브리핑을 드립니다.</li>
        <li>키는 이 PC에만 저장되고, 저장한 뒤에는 화면에 다시 보이지 않습니다.</li>
      </ul>
      <Disclaimer>Vater는 주문 기능이 없습니다. 매매 판단과 주문은 직접 하세요.</Disclaimer>
    </div>
  );
}

function KisStep({
  secrets,
  onSecretsSaved,
  settings,
  save,
  onTested,
}: {
  secrets: Record<string, boolean> | undefined;
  onSecretsSaved: () => void;
  settings: Settings | undefined;
  save: (changes: Settings) => Promise<boolean>;
  onTested: (ok: boolean) => void;
}) {
  const test = useKisTest();
  const saved = Boolean(secrets?.KIS_APP_KEY && secrets?.KIS_APP_SECRET);
  return (
    <div className={styles.body}>
      <h2 className={styles.heading}>한국투자증권 연결</h2>
      <p className={styles.text}>
        앱키와 앱시크릿을 넣고, 키를 받은 서버(실전·모의)를 고른 뒤 저장하고 연결 테스트를 누르세요.
        입력한 키를 저장한 다음 바로 그 키로 시험합니다. 시세 조회만 하며 주문은 하지 않습니다.
      </p>
      <details className={styles.help}>
        <summary>앱키는 어디서 받나요?</summary>
        <p>
          한국투자증권 홈페이지나 앱의 KIS Developers에서 Open API를 신청하면 앱키와 앱시크릿이
          나옵니다. 모의투자로 신청한 키라면 아래에서 모의 서버를 고르세요. 키는 이 PC에만
          저장됩니다.
        </p>
      </details>
      <KisServerChoice
        settings={settings}
        save={async (changes) => {
          test.reset(); // 이전 결과는 다른 서버의 것이다
          onTested(false);
          return save(changes);
        }}
      />
      <SecretForm
        fields={KIS_FIELDS}
        status={secrets}
        label="저장하고 연결 테스트"
        allowEmpty={saved}
        emptyMessage="앱키와 앱시크릿을 입력하세요."
        onSaved={async () => {
          onTested(false);
          onSecretsSaved();
          onTested(await test.run());
        }}
      />
      <KisTestOutcome test={test} />
    </div>
  );
}

function AiStep({
  choice,
  onChoice,
  catalog,
  secrets,
  onSecretsSaved,
  settings,
  save,
}: {
  choice: AiChoice;
  onChoice: (choice: AiChoice) => void;
  catalog: CatalogOut | undefined;
  secrets: Record<string, boolean> | undefined;
  onSecretsSaved: () => void;
  settings: Settings | undefined;
  save: (changes: Settings) => Promise<boolean>;
}) {
  const hardware = useResource<HardwareOut>('/llm/hardware');
  const hw = hardware.data;
  const options: { value: AiChoice; label: string }[] = [
    { value: 'cloud', label: '클라우드 AI 키 넣기' },
    { value: 'local', label: '이 PC에 로컬 AI 설치' },
    { value: 'later', label: '나중에' },
  ];
  return (
    <div className={styles.body}>
      <h2 className={styles.heading}>AI 엔진</h2>
      <p className={styles.text}>
        종목 분석과 브리핑 해석에 쓸 AI를 고릅니다. 클라우드는 빠르고 키가 필요합니다(Google
        Gemini는 무료 등급이 있습니다). 로컬은 이 PC에서 돌아 키가 필요 없지만 한 건에 수십 분 걸릴
        수 있습니다.
      </p>
      {hw ? (
        <p className={styles.hint}>
          {`이 PC(${hw.tier_label})에는 ${withObjectParticle(PRESET_LABEL[hw.default_preset] ?? hw.default_preset)} 권합니다.`}
        </p>
      ) : null}
      <div className={form.choices}>
        <span className={form.legend} aria-hidden="true">
          어떻게 할까요?
        </span>
        <SegmentedControl
          label="어떻게 할까요?"
          value={choice}
          options={options}
          onChange={onChoice}
        />
      </div>
      {choice === 'cloud' ? (
        <CloudSettings
          catalog={catalog}
          secrets={secrets}
          onSecretsSaved={onSecretsSaved}
          settings={settings}
          save={save}
          showModels={false}
        />
      ) : null}
      {choice === 'local' ? (
        <LocalSettings catalog={catalog} settings={settings} save={save} />
      ) : null}
      {choice === 'later' ? (
        <p className={styles.hint}>
          AI 없이도 알림과 브리핑 데이터는 동작합니다. 설정 &gt; AI 엔진에서 언제든 정할 수
          있습니다.
        </p>
      ) : null}
    </div>
  );
}

function WatchStep() {
  const api = useApi();
  const watch = useResource<WatchItem[]>('/watchlist');
  const [added, setAdded] = useState<WatchItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const keys = new Set([...(watch.data ?? []), ...added].map(symbolKey));

  async function add(market: string, code: string) {
    setBusy(`${market}:${code}`);
    setError(null);
    try {
      const item = await api.request<WatchItem>('/watchlist', {
        method: 'POST',
        body: { market, code },
      });
      setAdded((prev) => [...prev, item]);
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.body}>
      <h2 className={styles.heading}>감시 종목(선택)</h2>
      <p className={styles.text}>
        지켜볼 종목을 넣어 두면 홈에서 시세를 보고, 감시·알림에서 알림 규칙을 만들 수 있습니다.
        나중에 해도 됩니다.
      </p>
      <SymbolSearch
        actionLabel="추가"
        marked={{ keys, label: '감시 중' }}
        busyKey={busy}
        onPick={(s) => void add(s.market, s.code)}
      />
      {error ? <ApiErrorNotice error={error} /> : null}
      {added.length > 0 ? (
        <ul className={styles.added} aria-label="추가한 종목">
          {added.map((w) => (
            <li key={w.id} className={common.result}>
              <StockName market={w.market} name={w.name} code={w.code} />
              <span className={common.resultAction}>
                <span className={common.stockMeta}>추가됨</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function DoneStep({
  autostart,
  onAutostart,
  browser,
}: {
  autostart: boolean;
  onAutostart: (on: boolean) => void;
  browser: boolean;
}) {
  return (
    <div className={styles.body}>
      <h2 className={styles.heading}>준비가 끝났습니다</h2>
      <p className={styles.text}>
        시작하기를 누르면 홈으로 갑니다. 창을 닫아도 Vater는 트레이에서 감시를 계속합니다.
      </p>
      <Toggle label="부팅 시 자동 실행" checked={autostart} onChange={onAutostart} />
      <span className={styles.hint}>
        {browser
          ? '설치한 앱에서 적용됩니다(지금은 개발용 브라우저 화면).'
          : 'PC를 켜면 Vater가 트레이에서 시작해 알림 감시를 이어 갑니다.'}
      </span>
    </div>
  );
}

/** 첫 실행 마법사(스펙 9-2): ① 환영·면책 → ② 한투 연결 → ③ AI 엔진 → ④ 감시 종목(선택) → ⑤ 완료. */
export function WelcomeScreen() {
  const { platform } = useServices();
  const settings = useSettings();
  const secrets = useResource<Record<string, boolean>>('/secrets');
  const catalog = useResource<CatalogOut>('/llm/catalog');
  const hardware = useResource<HardwareOut>('/llm/hardware');
  const [index, setIndex] = useState(0);
  const [kisOk, setKisOk] = useState(false);
  const [ai, setAi] = useState<AiChoice>('later');
  const [autostart, setAutostart] = useState(true);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  function chooseAi(choice: AiChoice) {
    setAi(choice);
    if (choice === 'cloud') void settings.save({ 'llm.preset': 'cloud' });
    if (choice === 'local') {
      // 로컬을 고르면 이 PC 등급의 권장 프리셋(혼합 또는 로컬)
      const preset = hardware.data?.default_preset;
      void settings.save({
        'llm.preset': preset === 'mixed' || preset === 'local' ? preset : 'local',
      });
    }
  }

  async function finish() {
    setFinishing(true);
    setError(null);
    try {
      await platform.setAutostart(autostart);
      navigate({ name: 'home' });
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setFinishing(false);
    }
  }

  const last = index === STEPS.length - 1;
  const canNext = index !== 1 || kisOk;

  return (
    <main className={styles.page}>
      <div className={styles.brand}>
        <span className={styles.wordmark} aria-hidden="true">
          Vater
        </span>
        <h1 className={styles.title}>Vater 시작하기</h1>
      </div>
      <ol className={styles.steps} aria-label="단계">
        {STEPS.map((name, i) => (
          <li
            key={name}
            className={styles.step}
            aria-current={i === index ? 'step' : undefined}
            data-done={i < index ? 'true' : 'false'}
          >
            <span className={`${styles.num} vt-num`}>{i + 1}</span>
            {name}
          </li>
        ))}
      </ol>

      {index === 0 ? <Intro /> : null}
      {index === 1 ? (
        <KisStep
          secrets={secrets.data}
          onSecretsSaved={secrets.reload}
          settings={settings.data}
          save={settings.save}
          onTested={setKisOk}
        />
      ) : null}
      {index === 2 ? (
        <AiStep
          choice={ai}
          onChoice={chooseAi}
          catalog={catalog.data}
          secrets={secrets.data}
          onSecretsSaved={secrets.reload}
          settings={settings.data}
          save={settings.save}
        />
      ) : null}
      {index === 3 ? <WatchStep /> : null}
      {index === 4 ? (
        <DoneStep
          autostart={autostart}
          onAutostart={setAutostart}
          browser={platform.kind === 'browser'}
        />
      ) : null}

      {settings.error ? (
        <ApiErrorNotice error={settings.error} title="설정을 저장하지 못했습니다" />
      ) : null}
      {error ? <ApiErrorNotice error={error} /> : null}

      <div className={styles.nav}>
        {index > 0 ? <Button onClick={() => setIndex((i) => i - 1)}>뒤로</Button> : null}
        <span className={styles.navEnd}>
          {index === 1 && !kisOk ? (
            <span className={styles.hint}>연결 테스트에 성공하면 다음으로 갈 수 있습니다.</span>
          ) : null}
          {last ? (
            <Button variant="primary" busy={finishing} onClick={finish}>
              시작하기
            </Button>
          ) : (
            <Button variant="primary" disabled={!canNext} onClick={() => setIndex((i) => i + 1)}>
              다음
            </Button>
          )}
        </span>
      </div>
    </main>
  );
}
