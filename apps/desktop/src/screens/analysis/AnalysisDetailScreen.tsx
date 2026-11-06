import { useState } from 'react';
import { ApiError, toApiError } from '../../api/errors';
import { useAnalysisProgress, useApi, useEvent } from '../../api/services';
import { useResource } from '../../api/useResource';
import type { AnalysisDetail, AnalysisQueued } from '../../api/types';
import { Banner, Button, Card } from '../../design-system';
import { navigate } from '../../app/router';
import { PRESET_LABEL } from '../../app/status';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import { marketLabel } from '../common/quotes';
import { ScreenHeader } from '../common/ScreenHeader';
import common from '../common/screen.module.css';
import { formatDay, formatDayTime, formatDuration } from '../common/time';
import styles from './analysis.module.css';
import { AnalysisResult } from './AnalysisResult';
import { DELETED_ANALYSIS, DeleteAnalysisDialog } from './DeleteAnalysisDialog';
import { StageTimeline } from './StageTimeline';
import { isActiveStatus, STATUS_LABEL } from './stages';

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (e) {
      setError(toApiError(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

function Progress({ detail, onChanged }: { detail: AnalysisDetail; onChanged: () => void }) {
  const api = useApi();
  const tracked = useAnalysisProgress(detail.id);
  const progress = tracked ?? { timings: {}, current: null, elapsed: 0 };
  // 창을 다시 열었거나 앱을 새로 켰으면 다음 진행 소식이 올 때까지 단계를 모른다
  const unknownStage = detail.status === 'running' && !tracked;
  const cancel = useAction();
  const [cancelling, setCancelling] = useState(false);

  async function requestCancel() {
    const out = await cancel.run(() =>
      api.request<AnalysisQueued>(`/analyses/${detail.id}/cancel`, { method: 'POST' }),
    );
    if (!out) return;
    if (out.status === 'cancelling') setCancelling(true);
    else onChanged();
  }

  return (
    <Card title="진행" description={STATUS_LABEL[detail.status]}>
      <div className={styles.opinion}>
        {unknownStage ? (
          <p className={styles.note}>단계 확인 중: 다음 진행 소식이 오면 바로 보입니다.</p>
        ) : null}
        {progress.waiting ? <Banner tone="caution" title={progress.waiting} /> : null}
        <StageTimeline
          timings={progress.timings}
          current={progress.current}
          status={unknownStage ? 'unknown' : detail.status}
        />
        <div className={styles.progressFoot}>
          <span className={`${styles.note} vt-num`}>
            {progress.elapsed > 0
              ? `경과 ${formatDuration(progress.elapsed)}`
              : `요청 ${formatDayTime(detail.created_at)}`}
          </span>
          <Button busy={cancel.busy || cancelling} onClick={requestCancel}>
            분석 취소
          </Button>
        </div>
        {cancelling ? (
          <p className={styles.note}>취소를 요청했습니다. 지금 단계가 끝나면 멈춥니다.</p>
        ) : null}
        {cancel.error ? <ApiErrorNotice error={cancel.error} /> : null}
        <p className={common.meta}>
          분석 한 건은 수 분에서 수십 분 걸립니다. 창을 닫아도 분석은 계속되고, 끝나면 알림을
          보냅니다.
        </p>
      </div>
    </Card>
  );
}

function newAnalysisHref(detail: AnalysisDetail): string {
  const q = new URLSearchParams({ market: detail.market, code: detail.code, as_of: detail.as_of });
  return `/analyses?${q.toString()}`;
}

function Stopped({ detail }: { detail: AnalysisDetail }) {
  const api = useApi();
  const retry = useAction();
  const failed = detail.status === 'failed';
  const code = failed ? detail.error?.code : undefined;
  const daily = code === 'LLM_DAILY_LIMIT'; // 오늘은 다시 해도 안 된다: 방식 바꾸기가 먼저
  const badKey = code === 'LLM_KEY_INVALID'; // 다시 해도 안 된다: 설정에서 키를 고친다

  async function again() {
    const out = await retry.run(() =>
      api.request<AnalysisQueued>(`/analyses/${detail.id}/retry`, { method: 'POST' }),
    );
    if (out) navigate({ name: 'analysis', id: out.id });
  }

  return (
    <Card title={failed ? '분석 실패' : '분석 취소됨'}>
      <div className={styles.opinion}>
        {failed && detail.error ? (
          <ApiErrorNotice
            error={
              new ApiError(detail.error.code, detail.error.message, detail.error.hint ?? null, 0)
            }
          />
        ) : failed ? (
          <Banner tone="caution" title="분석이 실패했습니다." />
        ) : (
          <p className={styles.note}>분석을 취소했습니다.</p>
        )}
        <StageTimeline timings={detail.timings} current={null} status={detail.status} />
        <p className={common.meta}>
          다시 시도는 같은 종목·기준일·AI 사용 방식으로 이어서 실행합니다(이미 마친 단계는 다시 하지
          않음).
        </p>
        {retry.error ? <ApiErrorNotice error={retry.error} /> : null}
        <div className={styles.actions}>
          {badKey ? (
            <Button variant="primary" onClick={() => navigate({ name: 'settings' })}>
              설정 열기
            </Button>
          ) : (
            <Button variant={daily ? 'secondary' : 'primary'} busy={retry.busy} onClick={again}>
              다시 시도
            </Button>
          )}
          <Button
            variant={daily ? 'primary' : 'secondary'}
            onClick={() => navigate(newAnalysisHref(detail))}
          >
            AI 사용 방식 바꿔 새로 분석
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** 지우기: 진행 중이면 막고 이유를 보인다. 지우면 분석 목록으로 간다. */
function DeleteAction({ detail }: { detail: AnalysisDetail }) {
  const api = useApi();
  const del = useAction();
  const [confirming, setConfirming] = useState(false);
  const active = isActiveStatus(detail.status);

  async function remove() {
    const done = await del.run(() =>
      api.request(`/analyses/${detail.id}`, { method: 'DELETE' }).then(() => true),
    );
    if (done) navigate({ name: 'analyses' });
  }

  return (
    <>
      <Button disabled={active} onClick={() => setConfirming(true)}>
        분석 지우기
      </Button>
      {active ? (
        <p className={common.meta}>진행 중인 분석은 끝나거나 취소한 뒤 지울 수 있습니다.</p>
      ) : null}
      {confirming ? (
        <DeleteAnalysisDialog
          count={1}
          busy={del.busy}
          error={del.error}
          onConfirm={remove}
          onClose={() => setConfirming(false)}
        />
      ) : null}
    </>
  );
}

/** 분석 하나(#/analyses/:id): 대기·실행 중이면 진행 타임라인, 끝나면 결과, 실패·취소면 원인과 다시 시도. */
export function AnalysisDetailScreen({ id }: { id: number }) {
  const detail = useResource<AnalysisDetail>(`/analyses/${id}`);
  const { reload } = detail;
  const [deleted, setDeleted] = useState(false);
  useEvent('analysis.status', (event) => {
    if (event.id === id) reload();
  });
  useEvent('analysis.deleted', (event) => {
    if (event.ids.includes(id)) setDeleted(true);
  });

  // 지워진 분석(알림 경로 등): 404도 같은 안내
  if (deleted || detail.error?.status === 404) {
    return (
      <>
        <ScreenHeader title="분석" />
        <Banner
          tone="info"
          title={DELETED_ANALYSIS}
          action={
            <a className={common.textLink} href="#/analyses">
              분석 목록
            </a>
          }
        >
          분석 이력에서 지운 분석입니다.
        </Banner>
      </>
    );
  }

  const d = detail.data;
  const title = d ? `${d.name ?? d.code} 분석` : '분석';
  const lede = d
    ? `${marketLabel(d.market)} ${d.code} · 기준일 ${formatDay(d.as_of)} · ${PRESET_LABEL[d.preset] ?? d.preset}`
    : undefined;

  let body = null;
  if (d) {
    if (d.status === 'queued' || d.status === 'running')
      body = <Progress detail={d} onChanged={reload} />;
    else if (d.status === 'done') body = <AnalysisResult detail={d} />;
    else body = <Stopped detail={d} />;
  }

  return (
    <>
      <ScreenHeader
        title={title}
        lede={lede}
        end={
          <a className={common.textLink} href="#/analyses">
            분석 목록
          </a>
        }
      />
      {detail.error ? (
        <ApiErrorNotice error={detail.error} title="분석을 불러오지 못했습니다" onRetry={reload} />
      ) : null}
      {body}
      {d ? <DeleteAction detail={d} /> : null}
    </>
  );
}
