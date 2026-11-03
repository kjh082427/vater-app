import { useState } from 'react';
import { ApiError, toApiError } from '../../api/errors';
import { useApi, useEvent } from '../../api/services';
import { useResource } from '../../api/useResource';
import type { CatalogOut, EventMap, HardwareOut, LocalModel, OllamaStatus } from '../../api/types';
import { Button, formatNumber } from '../../design-system';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import { Field } from '../common/Field';
import form from '../common/form.module.css';
import common from '../common/screen.module.css';
import styles from './settings.module.css';
import { str, type Settings } from './useSettings';

const INSTALL_STAGE: Record<string, string> = {
  download: '설치 파일을 내려받는 중입니다.',
  verify: '설치 파일의 서명을 확인하는 중입니다.',
  launch: '설치 프로그램을 실행하는 중입니다.',
  waiting: 'Ollama가 켜지기를 기다리는 중입니다.',
};

type Pull = EventMap['llm.pull'];

const gb = (bytes: number | null | undefined) =>
  typeof bytes === 'number' ? formatNumber(bytes / 1e9, 1) : '—';

const isInstalled = (model: LocalModel, status: OllamaStatus | undefined) =>
  (status?.models ?? []).some((m) => m.name === model.variant || m.name === model.tag);

function ModelRow({
  model,
  recommended,
  installed,
  running,
  pull,
  onPull,
  onDelete,
}: {
  model: LocalModel;
  recommended: boolean;
  installed: boolean;
  running: boolean;
  pull: Pull | 'starting' | undefined;
  onPull: () => void;
  onDelete: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const progress = pull && pull !== 'starting' ? pull : null;
  const pulling = pull !== undefined && progress?.status !== 'error';

  return (
    <li className={styles.model}>
      <span className={styles.modelText}>
        <span className={styles.modelHead}>
          <b>{model.label}</b>
          <span
            className={`${common.stockMeta} vt-num`}
          >{`${formatNumber(model.size_gb, 1)}GB`}</span>
          {recommended ? <span className={common.stockMeta}>추천</span> : null}
          {installed ? <span className={common.stockMeta}>설치됨</span> : null}
        </span>
        <span className={common.meta}>{model.note}</span>
      </span>
      <span className={styles.modelActions}>
        {installed && !confirming ? (
          <Button size="sm" variant="quiet" onClick={() => setConfirming(true)}>
            삭제
          </Button>
        ) : null}
        {installed && confirming ? (
          <>
            <Button
              size="sm"
              busy={busy}
              onClick={async () => {
                setBusy(true);
                await onDelete();
                setBusy(false);
                setConfirming(false);
              }}
            >
              모델 삭제
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setConfirming(false)}>
              취소
            </Button>
          </>
        ) : null}
        {!installed ? (
          <Button
            size="sm"
            busy={pulling}
            disabled={!running}
            aria-label={`${model.label} 받기`}
            onClick={onPull}
          >
            받기
          </Button>
        ) : null}
      </span>
      {pulling && !installed ? (
        <span className={`${styles.wide} ${styles.fields}`}>
          <progress
            className={styles.progress}
            aria-label={`${model.label} 받는 중`}
            max={100}
            {...(typeof progress?.percent === 'number' ? { value: progress.percent } : {})}
          />
          <span className={`${common.meta} vt-num`}>
            {typeof progress?.percent === 'number'
              ? `${formatNumber(progress.percent, 0)}% · ${gb(progress.completed)} / ${gb(progress.total)}GB`
              : '받기를 시작했습니다.'}
          </span>
        </span>
      ) : null}
      {progress?.status === 'error' ? (
        <span className={styles.wide}>
          <ApiErrorNotice
            error={
              new ApiError(
                progress.code ?? 'LLM_PULL_FAILED',
                progress.message ?? '모델을 받지 못했습니다.',
                progress.hint ?? null,
                0,
              )
            }
          />
        </span>
      ) : null}
    </li>
  );
}

/** 로컬 AI(Ollama): 하드웨어 등급·추천 모델, Ollama 상태·설치·시작, 모델 받기(진행률 SSE llm.pull)·삭제. */
export function LocalSettings({
  catalog,
  settings,
  save,
  showChoice = true,
}: {
  catalog: CatalogOut | undefined;
  settings: Settings | undefined;
  save: (changes: Settings) => Promise<boolean>;
  showChoice?: boolean;
}) {
  const api = useApi();
  const hardware = useResource<HardwareOut>('/llm/hardware');
  const status = useResource<OllamaStatus>('/llm/ollama/status');
  const [pulls, setPulls] = useState<Record<string, Pull | 'starting'>>({});
  const [install, setInstall] = useState<EventMap['llm.install'] | 'starting' | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [starting, setStarting] = useState(false);

  useEvent('llm.pull', (event) => {
    if (event.status === 'done') {
      setPulls((prev) =>
        Object.fromEntries(Object.entries(prev).filter(([tag]) => tag !== event.tag)),
      );
      status.reload();
      return;
    }
    setPulls((prev) => ({ ...prev, [event.tag]: event }));
  });
  useEvent('llm.install', (event) => {
    if (event.stage === 'done') {
      setInstall(null);
      status.reload();
      return;
    }
    setInstall(event);
  });

  async function act(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(toApiError(e));
    }
  }

  async function pull(model: LocalModel) {
    setPulls((prev) => ({ ...prev, [model.tag]: 'starting' }));
    try {
      await api.request(`/llm/models/${encodeURIComponent(model.tag)}/pull`, { method: 'POST' });
    } catch (e) {
      setPulls((prev) =>
        Object.fromEntries(Object.entries(prev).filter(([tag]) => tag !== model.tag)),
      );
      setError(toApiError(e));
    }
  }

  async function startInstall() {
    setInstall('starting');
    setError(null);
    try {
      const out = await api.request<{ started: boolean }>('/llm/ollama/install', {
        method: 'POST',
      });
      if (!out.started) {
        setInstall(null);
        status.reload();
      }
    } catch (e) {
      setInstall(null);
      setError(toApiError(e));
    }
  }

  const s = status.data;
  const hw = hardware.data;
  const models = catalog?.local_models ?? [];
  const installed = models.filter((m) => isInstalled(m, s));
  const installing = install !== null && install !== 'starting' ? install : null;

  return (
    <div className={styles.body}>
      {hw ? (
        <dl className={styles.facts}>
          <dt>이 PC</dt>
          <dd>
            <b>{hw.tier_label}</b>
          </dd>
          {hw.gpus.map((g) => (
            <div key={g.name} className={styles.group}>
              <dt>GPU</dt>
              <dd className="vt-num">{`${g.name} · VRAM ${formatNumber(g.vram_mb / 1024, 1)}GB`}</dd>
            </div>
          ))}
          <dt>추천</dt>
          <dd>
            {hw.recommended
              ? `${hw.recommended.label}${hw.expected_minutes ? ` · 분석 1건 약 ${hw.expected_minutes}분` : ''}`
              : '이 PC에는 로컬 모델 대신 클라우드를 권합니다.'}
          </dd>
        </dl>
      ) : null}
      {hardware.error ? (
        <ApiErrorNotice error={hardware.error} title="하드웨어를 확인하지 못했습니다" />
      ) : null}

      {s ? (
        <div className={form.actions}>
          {s.running ? (
            <span className={styles.ok}>
              {s.version ? `Ollama ${s.version} · 실행 중` : 'Ollama 실행 중'}
            </span>
          ) : s.installed ? (
            <>
              <span className={styles.warn}>Ollama가 꺼져 있습니다.</span>
              <Button
                size="sm"
                busy={starting}
                onClick={() =>
                  act(async () => {
                    setStarting(true);
                    try {
                      await api.request('/llm/ollama/start', { method: 'POST' });
                      status.reload();
                    } finally {
                      setStarting(false);
                    }
                  })
                }
              >
                Ollama 시작
              </Button>
            </>
          ) : (
            <>
              <span className={styles.warn}>Ollama가 설치되어 있지 않습니다.</span>
              <Button size="sm" busy={install !== null} onClick={startInstall}>
                Ollama 설치
              </Button>
            </>
          )}
        </div>
      ) : null}
      {installing ? (
        installing.stage === 'error' ? (
          <ApiErrorNotice
            error={
              new ApiError(
                installing.code ?? 'OLLAMA_INSTALL_FAILED',
                installing.message ?? '설치하지 못했습니다.',
                installing.hint ?? null,
                0,
              )
            }
          />
        ) : (
          <p role="status" className={common.meta}>
            {INSTALL_STAGE[installing.stage] ?? installing.stage}
          </p>
        )
      ) : null}
      {status.error ? (
        <ApiErrorNotice
          error={status.error}
          title="Ollama 상태를 확인하지 못했습니다"
          onRetry={status.reload}
        />
      ) : null}
      {error ? <ApiErrorNotice error={error} /> : null}

      {models.length > 0 ? (
        <ul className={styles.models} aria-label="로컬 모델">
          {models.map((m) => (
            <ModelRow
              key={m.tag}
              model={m}
              recommended={hw?.recommended?.tag === m.tag}
              installed={isInstalled(m, s)}
              running={Boolean(s?.running)}
              pull={pulls[m.tag]}
              onPull={() => void pull(m)}
              onDelete={() =>
                act(async () => {
                  await api.request(`/llm/models/${encodeURIComponent(m.tag)}`, {
                    method: 'DELETE',
                  });
                  status.reload();
                })
              }
            />
          ))}
        </ul>
      ) : null}

      {showChoice ? (
        <Field label="분석에 쓸 로컬 모델" hint="받은 모델 중에서 고릅니다.">
          {(control) => (
            <select
              {...control}
              className={form.control}
              value={str(settings, 'llm.local_model')}
              disabled={!settings}
              onChange={(e) => void save({ 'llm.local_model': e.target.value })}
            >
              <option value="">고르지 않음</option>
              {installed.map((m) => (
                <option key={m.tag} value={m.tag}>
                  {m.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      ) : null}
    </div>
  );
}
