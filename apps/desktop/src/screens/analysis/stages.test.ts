import { describe, expect, it } from 'vitest';
import { STAGES, stageLabel, visibleStage } from './stages';

describe('분석 진행 단계', () => {
  it('5단계만 이 순서로 보인다(스펙 5장 타임라인)', () => {
    expect(STAGES.map((s) => s.label)).toEqual([
      '애널리스트',
      '강세·약세 토론',
      '트레이더',
      '리스크 토론',
      '포트폴리오 매니저',
    ]);
  });

  it.each(['analysts', 'research', 'trader', 'risk', 'portfolio'])('%s는 보인다', (stage) => {
    expect(visibleStage(stage)).toBe(stage);
  });

  it.each(['other', '', 'Market Analyst'])('%j는 숨긴다', (stage) => {
    expect(visibleStage(stage)).toBeNull();
  });

  it('이름', () => {
    expect(stageLabel('risk')).toBe('리스크 토론');
  });
});
