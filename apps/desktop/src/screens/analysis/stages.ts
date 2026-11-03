/**
 * 분석 진행 단계(스펙 5장): 애널리스트 → 강세·약세 토론 → 트레이더 → 리스크 토론 → 포트폴리오 매니저.
 * 사이드카는 이 다섯에 들지 않는 노드를 `other`로 보내는데, 화면에는 보이지 않는다.
 */
export type StageId = 'analysts' | 'research' | 'trader' | 'risk' | 'portfolio';

export const STAGES: readonly { id: StageId; label: string }[] = [
  { id: 'analysts', label: '애널리스트' },
  { id: 'research', label: '강세·약세 토론' },
  { id: 'trader', label: '트레이더' },
  { id: 'risk', label: '리스크 토론' },
  { id: 'portfolio', label: '포트폴리오 매니저' },
];

/** 보이는 단계면 그 id, 아니면(other 등) null. */
export function visibleStage(stage: string): StageId | null {
  return STAGES.some((s) => s.id === stage) ? (stage as StageId) : null;
}

export function stageLabel(stage: StageId): string {
  return STAGES.find((s) => s.id === stage)?.label ?? stage;
}

export const STATUS_LABEL: Record<string, string> = {
  queued: '대기 중',
  running: '실행 중',
  done: '완료',
  failed: '실패',
  cancelled: '취소됨',
};

export const isActiveStatus = (status: string) => status === 'queued' || status === 'running';
