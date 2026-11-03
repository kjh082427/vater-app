import { useState } from 'react';
import { useEvent } from '../../api/services';
import { visibleStage, type StageId } from './stages';

export interface ProgressState {
  /** 단계별 걸린 시간(초). 사이드카와 같은 방식: 직전 이벤트부터 이 이벤트까지를 이 이벤트의 단계에 더한다. */
  timings: Partial<Record<StageId, number>>;
  /** 지금 단계(보이는 단계만). other는 직전 단계를 그대로 둔다. */
  current: StageId | null;
  /** 시작부터 지난 시간(초). */
  elapsed: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** SSE analysis.progress로 분석 하나의 진행 상황을 모은다. other 단계의 시간은 어느 단계에도 더하지 않는다. */
export function useProgress(id: number): ProgressState {
  const [state, setState] = useState<ProgressState>({ timings: {}, current: null, elapsed: 0 });
  useEvent('analysis.progress', (p) => {
    if (p.id !== id) return;
    setState((s) => {
      const delta = Math.max(0, p.elapsed_sec - s.elapsed);
      const stage = visibleStage(p.stage);
      const timings = stage
        ? { ...s.timings, [stage]: round1((s.timings[stage] ?? 0) + delta) }
        : s.timings;
      return { timings, current: stage ?? s.current, elapsed: Math.max(s.elapsed, p.elapsed_sec) };
    });
  });
  return state;
}
