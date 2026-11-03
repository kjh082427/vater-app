import { StatusDot } from '../../design-system';
import { formatDuration } from '../common/time';
import styles from './analysis.module.css';
import { STAGES, type StageId } from './stages';

type StepState = 'done' | 'current' | 'pending';

export interface StageTimelineProps {
  timings: Partial<Record<string, number>> | null | undefined;
  /** 실행 중이면 지금 단계. */
  current: StageId | null;
  status: string;
}

const PENDING_TEXT: Record<string, string> = {
  queued: '대기',
  running: '대기',
};

/**
 * 진행 타임라인(스펙 5장): 애널리스트 → 강세·약세 토론 → 트레이더 → 리스크 토론 → 포트폴리오 매니저.
 * 단계마다 상태 글자와 걸린 시간. 점은 장식이고 글자가 상태를 말한다.
 */
export function StageTimeline({ timings, current, status }: StageTimelineProps) {
  const active = status === 'queued' || status === 'running';
  const currentIndex = current ? STAGES.findIndex((s) => s.id === current) : -1;
  return (
    <ol className={styles.steps} aria-label="진행 단계">
      {STAGES.map((stage, index) => {
        const seconds = timings?.[stage.id];
        let state: StepState;
        if (active)
          state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'pending';
        else state = typeof seconds === 'number' ? 'done' : 'pending';
        const text =
          state === 'current'
            ? '진행 중'
            : state === 'done'
              ? status === 'done' || active
                ? '완료'
                : '진행함'
              : (PENDING_TEXT[status] ?? '진행 안 됨');
        return (
          <li key={stage.id} className={styles.step} data-state={state}>
            <StatusDot tone={state === 'pending' ? 'off' : 'on'} />
            <span className={styles.stepName}>{stage.label}</span>
            <span className={styles.stepState}>{text}</span>
            <span className={`${styles.stepTime} vt-num`}>
              {typeof seconds === 'number' ? formatDuration(seconds) : ''}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
