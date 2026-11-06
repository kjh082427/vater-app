/**
 * 분석 진행 상황 모으기(SSE analysis.progress). 앱이 켜져 있는 동안 화면과 상관없이 모아 두어,
 * 홈에서 보던 분석을 결과 화면으로 열어도 같은 진행 상황이 보인다.
 * 단계는 사이드카 계약(analysis/models.py Progress.stage): analysts → research → trader → risk → portfolio,
 * 그 밖은 other(화면에 보이지 않고 시간도 어느 단계에 더하지 않는다).
 */
import type { EventHub } from './events';
import type { EventMap } from './types';

export type StageId = 'analysts' | 'research' | 'trader' | 'risk' | 'portfolio';
export const STAGE_IDS: readonly StageId[] = [
  'analysts',
  'research',
  'trader',
  'risk',
  'portfolio',
];

/** 보이는 단계면 그 id, 아니면(other 등) null. */
export function visibleStage(stage: string): StageId | null {
  return (STAGE_IDS as readonly string[]).includes(stage) ? (stage as StageId) : null;
}

export interface ProgressState {
  /** 단계별 걸린 시간(초). 사이드카와 같은 방식: 직전 이벤트부터 이 이벤트까지를 이 이벤트의 단계에 더한다. */
  timings: Partial<Record<StageId, number>>;
  /** 지금 단계(보이는 단계만). other는 직전 단계를 그대로 둔다. */
  current: StageId | null;
  /** 시작부터 지난 시간(초). */
  elapsed: number;
  /** 구글 AI 혼잡·분당 한도로 기다리는 중이면 그 문구. 다음 진행 소식이 오면 지운다. */
  waiting?: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export class ProgressTracker {
  private states = new Map<number, ProgressState>();
  private listeners = new Set<() => void>();

  constructor(events: EventHub) {
    events.subscribe('analysis.progress', (p) => this.add(p));
  }

  get(id: number): ProgressState | undefined {
    return this.states.get(id);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private add(p: EventMap['analysis.progress']) {
    const s = this.states.get(p.id) ?? { timings: {}, current: null, elapsed: 0 };
    if (p.wait) {
      // 기다림은 단계 시간에 넣지 않는다(시간은 다음 단계 소식이 올 때 그 단계에 더한다)
      this.states.set(p.id, { ...s, waiting: p.wait.message });
      for (const listener of this.listeners) listener();
      return;
    }
    const delta = Math.max(0, p.elapsed_sec - s.elapsed);
    const stage = visibleStage(p.stage);
    this.states.set(p.id, {
      timings: stage
        ? { ...s.timings, [stage]: round1((s.timings[stage] ?? 0) + delta) }
        : s.timings,
      current: stage ?? s.current,
      elapsed: Math.max(s.elapsed, p.elapsed_sec),
    });
    for (const listener of this.listeners) listener();
  }
}
