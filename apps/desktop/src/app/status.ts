/**
 * 상태 표시줄과 사이드바 아래쪽의 글자(스펙 9-1). 색은 점 모양(DotTone)으로만 말하고,
 * 빨강·파랑은 쓰지 않는다(끊김·폴링·주의는 황토).
 */
import type { ApiError } from '../api/errors';
import type { CheckOut, MarketCode, MonitorState, MonitorStatus } from '../api/types';
import type { DotTone } from '../design-system';

export interface Summary {
  tone: DotTone;
  detail: string;
}

/** 뉴욕 시간대의 UTC 차이(시간). 예: 서머타임 -4, 아니면 -5. */
function newYorkOffsetHours(at: Date): number {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-5';
  const m = /GMT([+-]\d+)/.exec(name);
  return m ? Number(m[1]) : -5;
}

/** 장중이면 마감 시각(한국 시간). 국내 15:30, 미국 정규장 16:00(뉴욕). 마감·휴장은 적지 않는다. */
export function marketDetail(
  market: MarketCode,
  status: string,
  now: Date = new Date(),
): string | undefined {
  if (status !== 'open') return undefined;
  if (market === 'KR') return '15:30 마감';
  const hour = (((16 - newYorkOffsetHours(now) + 9) % 24) + 24) % 24;
  return `${String(hour).padStart(2, '0')}:00 마감`;
}

/** 한투 연결: 실시간(WebSocket) / 폴링 / 끊김. */
export function feedSummary(status: MonitorStatus | null | undefined): Summary {
  if (!status) return { tone: 'off', detail: '확인 중' };
  if (status.state === 'offline') return { tone: 'caution-strong', detail: '끊김 · 재연결 중' };
  const parts: string[] = [];
  if (status.realtime > 0) parts.push(`실시간 ${status.realtime}`);
  if (status.polling > 0) parts.push(`폴링 ${status.polling}`);
  if (parts.length > 0) {
    return { tone: status.polling > 0 ? 'caution' : 'on', detail: parts.join(' · ') };
  }
  if (status.state === 'paused') return { tone: 'off', detail: '감시 일시 중지' };
  if (status.state === 'closed') return { tone: 'off', detail: '장 외 시간 · 대기' };
  return { tone: 'off', detail: '대기' };
}

/** 사이드바 아래쪽 감시 상태(감시 상태는 여기 한곳에만 둔다, DESIGN.md 결정 14). */
export function watchSummary(state: MonitorState): { tone: DotTone; text: string } {
  switch (state) {
    case 'running':
      return { tone: 'on', text: '알림 감시 중' };
    case 'paused':
      return { tone: 'off', text: '감시 일시 중지됨' };
    case 'offline':
      return { tone: 'caution-strong', text: '감시 멈춤 · 오프라인' };
    case 'auth_invalid':
      return { tone: 'caution-strong', text: '감시 멈춤 · 한투 키 확인 필요' };
    case 'closed':
      return { tone: 'off', text: '장 외 시간 · 감시 쉼' };
  }
}

export const PRESET_LABEL: Record<string, string> = {
  cloud: '클라우드',
  local: '로컬',
  mixed: '혼합',
};

/** AI 엔진: 프리셋 · deep 모델 · 진행 중인 분석. */
export function engineSummary(
  check: CheckOut | undefined,
  error: ApiError | null,
  analyses: { running: number; queued: number },
): Summary {
  if (!check) {
    return error ? { tone: 'caution', detail: error.message } : { tone: 'off', detail: '확인 중' };
  }
  const parts = [PRESET_LABEL[check.preset] ?? check.preset, check.deep.model];
  if (analyses.running > 0) parts.push(`분석 ${analyses.running}건 진행 중`);
  if (analyses.queued > 0) parts.push(`대기 ${analyses.queued}건`);
  if (check.offloaded) parts.push('느림(VRAM 부족)');
  return { tone: check.offloaded ? 'caution' : 'on', detail: parts.join(' · ') };
}
