import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/errors';
import type { MonitorStatus } from '../api/types';
import { engineSummary, feedSummary, marketDetail, watchSummary } from './status';

const monitor = (over: Partial<MonitorStatus>): MonitorStatus => ({
  state: 'running',
  realtime: 0,
  polling: 0,
  markets: {},
  feeds: [],
  ...over,
});

describe('marketDetail: 장중일 때 마감 시각(한국 시간)', () => {
  it('국내는 15:30 마감', () => {
    expect(marketDetail('KR', 'open')).toBe('15:30 마감');
  });

  it('미국 정규장 16:00(뉴욕)은 서머타임이 아니면 06:00, 서머타임이면 05:00(한국 시간)', () => {
    expect(marketDetail('US', 'open', new Date('2026-01-15T15:00:00Z'))).toBe('06:00 마감');
    expect(marketDetail('US', 'open', new Date('2026-07-15T15:00:00Z'))).toBe('05:00 마감');
  });

  it('마감이면 시각을 적지 않는다(휴장일·다음 개장일을 모름)', () => {
    expect(marketDetail('KR', 'closed')).toBeUndefined();
  });
});

describe('feedSummary: 한투 연결', () => {
  it.each([
    [monitor({ realtime: 2, polling: 1 }), 'caution', '실시간 2 · 폴링 1'],
    [monitor({ realtime: 3 }), 'on', '실시간 3'],
    [monitor({ polling: 2 }), 'caution', '폴링 2'],
    [monitor({ state: 'offline', realtime: 2 }), 'caution-strong', '끊김 · 재연결 중'],
    [monitor({ state: 'paused' }), 'off', '감시 일시 중지'],
    [monitor({ state: 'closed' }), 'off', '장 외 시간 · 대기'],
    [monitor({ state: 'running' }), 'off', '대기'],
  ])('%j → %s %s', (status, tone, detail) => {
    expect(feedSummary(status)).toEqual({ tone, detail });
  });

  it('아직 모르면 확인 중', () => {
    expect(feedSummary(null)).toEqual({ tone: 'off', detail: '확인 중' });
  });
});

describe('watchSummary: 사이드바 아래 감시 상태', () => {
  it.each([
    ['running', 'on', '알림 감시 중'],
    ['paused', 'off', '감시 일시 중지됨'],
    ['offline', 'caution-strong', '감시 멈춤 · 오프라인'],
    ['closed', 'off', '장 외 시간 · 감시 쉼'],
  ] as const)('%s → %s %s', (state, tone, text) => {
    expect(watchSummary(state)).toEqual({ tone, text });
  });
});

describe('engineSummary: AI 엔진', () => {
  const check = {
    ok: true,
    preset: 'local',
    deep: { provider: 'ollama', model: 'qwen3.5:9b' },
    quick: { provider: 'ollama', model: 'qwen3.5:4b' },
    offloaded: null,
  };

  it('프리셋과 deep 모델, 진행 중·대기 분석', () => {
    expect(engineSummary(check, null, { running: 1, queued: 2 })).toEqual({
      tone: 'on',
      detail: '로컬 · qwen3.5:9b · 분석 1건 진행 중 · 대기 2건',
    });
  });

  it('모델이 VRAM에 다 안 올라가면 주의', () => {
    expect(engineSummary({ ...check, offloaded: true }, null, { running: 0, queued: 0 })).toEqual({
      tone: 'caution',
      detail: '로컬 · qwen3.5:9b · 느림(VRAM 부족)',
    });
  });

  it('확인이 실패하면 오류 문구', () => {
    const error = new ApiError('OLLAMA_NOT_RUNNING', 'Ollama가 꺼져 있습니다.', null, 503);
    expect(engineSummary(undefined, error, { running: 0, queued: 0 })).toEqual({
      tone: 'caution',
      detail: 'Ollama가 꺼져 있습니다.',
    });
  });

  it('아직 모르면 확인 중', () => {
    expect(engineSummary(undefined, null, { running: 0, queued: 0 })).toEqual({
      tone: 'off',
      detail: '확인 중',
    });
  });
});
