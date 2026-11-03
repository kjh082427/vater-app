import { useAnalysisProgress } from '../../api/services';
import type { AnalysisItem } from '../../api/types';
import { hrefOf } from '../../app/router';
import { ProgressBar } from '../../design-system';
import { STAGES, stageLabel, STATUS_LABEL } from '../../screens/analysis/stages';
import { marketLabel } from '../../screens/common/quotes';
import { formatDuration } from '../../screens/common/time';
import { useShared } from '../shared';
import { activeOf, analysesSource } from '../sources';
import { PanelEmpty, PanelError, styles } from './common';

/** 단계 진행률(0~100): 지금 단계 앞까지 끝난 단계의 몫. 대기 중이면 0. */
export function useStagePercent(item: AnalysisItem): { percent: number; text: string } {
  const progress = useAnalysisProgress(item.id);
  const parts = [STATUS_LABEL[item.status] ?? item.status];
  let percent = 0;
  if (item.status === 'running' && progress) {
    if (progress.current) {
      parts.push(stageLabel(progress.current));
      const at = STAGES.findIndex((s) => s.id === progress.current);
      percent = at < 0 ? 0 : Math.round((at / STAGES.length) * 100);
    }
    parts.push(formatDuration(progress.elapsed));
  }
  return { percent, text: parts.join(' · ') };
}

function Row({ item }: { item: AnalysisItem }) {
  const { percent, text } = useStagePercent(item);
  const name = item.name ?? item.code;
  return (
    <li>
      <a className={styles.itemText} href={hrefOf({ name: 'analysis', id: item.id })}>
        {name}
      </a>
      <span
        className={`${styles.itemMeta} vt-num`}
      >{`${marketLabel(item.market)} ${item.code}`}</span>
      <span className={`${styles.itemMeta} vt-num`}>{text}</span>
      <ProgressBar value={percent} label={`${name} 분석 진행`} />
    </li>
  );
}

/** 진행 중인 분석: 대기·실행 중인 분석과 단계·경과 시간. */
export function RunningAnalysesPanel() {
  const list = useShared(analysesSource);
  if (list.error) {
    return (
      <PanelError
        error={list.error}
        title="분석 목록을 불러오지 못했습니다"
        onRetry={list.reload}
      />
    );
  }
  const active = activeOf(list.data);
  if (!active) return <div className={styles.body} aria-busy="true" />;
  if (active.length === 0) {
    return (
      <PanelEmpty>
        진행 중인 분석이 없습니다 · <a href="#/analyses">새 분석</a>
      </PanelEmpty>
    );
  }
  return (
    <div className={styles.body}>
      <ul className={styles.list} aria-label="진행 중인 분석">
        {active.map((a) => (
          <Row key={a.id} item={a} />
        ))}
      </ul>
    </div>
  );
}
