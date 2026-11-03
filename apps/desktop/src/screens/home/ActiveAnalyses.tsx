import { useState } from 'react';
import { useEvent } from '../../api/services';
import { useResource } from '../../api/useResource';
import type { AnalysisItem } from '../../api/types';
import { Section } from '../../design-system';
import { hrefOf } from '../../app/router';
import {
  isActiveStatus,
  stageLabel,
  STATUS_LABEL,
  visibleStage,
  type StageId,
} from '../analysis/stages';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import { marketLabel } from '../common/quotes';
import common from '../common/screen.module.css';
import { formatDuration } from '../common/time';
import styles from './home.module.css';

interface Progress {
  stage: StageId | null;
  elapsed: number;
}

function progressText(item: AnalysisItem, progress: Progress | undefined): string {
  const parts = [STATUS_LABEL[item.status] ?? item.status];
  if (item.status === 'running' && progress) {
    if (progress.stage) parts.push(stageLabel(progress.stage));
    parts.push(formatDuration(progress.elapsed));
  }
  return parts.join(' · ');
}

/** 진행 중인 분석: 대기·실행 중인 분석과 단계·경과 시간(SSE analysis.status / analysis.progress). */
export function ActiveAnalyses() {
  const list = useResource<AnalysisItem[]>('home:active-analyses', async (api) => {
    const items = await api.request<AnalysisItem[]>('/analyses', { query: { limit: 20 } });
    return items.filter((a) => isActiveStatus(a.status));
  });
  const [progress, setProgress] = useState<Record<number, Progress>>({});
  const { data, mutate, reload } = list;

  useEvent('analysis.status', (event) => {
    if (!isActiveStatus(event.status)) {
      mutate((items) => items?.filter((a) => a.id !== event.id));
      return;
    }
    if (data?.some((a) => a.id === event.id)) {
      mutate((items) =>
        items?.map((a) => (a.id === event.id ? { ...a, status: event.status } : a)),
      );
    } else {
      reload(); // 새 분석: 종목 이름이 필요하다
    }
  });
  useEvent('analysis.progress', (p) =>
    setProgress((prev) => ({
      ...prev,
      // other 단계는 보이지 않는다: 직전에 보이던 단계를 그대로 둔다
      [p.id]: { stage: visibleStage(p.stage) ?? prev[p.id]?.stage ?? null, elapsed: p.elapsed_sec },
    })),
  );

  return (
    <Section title="진행 중인 분석">
      {list.error ? (
        <ApiErrorNotice
          error={list.error}
          title="분석 목록을 불러오지 못했습니다"
          onRetry={reload}
        />
      ) : null}
      {data && data.length === 0 ? (
        <p className={common.empty}>
          진행 중인 분석이 없습니다. 새 분석을 누르면 종목 분석을 시작합니다.
        </p>
      ) : null}
      {data && data.length > 0 ? (
        <ul className={styles.list}>
          {data.map((a) => (
            <li key={a.id} className={styles.item}>
              <span className={styles.itemHead}>
                <a className={styles.itemLink} href={hrefOf({ name: 'analysis', id: a.id })}>
                  <b>{a.name ?? a.code}</b>
                </a>
                <span className={`${styles.itemMeta} vt-num`}>
                  {`${marketLabel(a.market)} ${a.code} · 기준일 ${a.as_of}`}
                </span>
              </span>
              <span className={`${styles.progress} vt-num`}>{progressText(a, progress[a.id])}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}
