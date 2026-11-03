import { describe, expect, it } from 'vitest';
import { formatClock, formatDay, formatDayTime, formatDuration } from './time';

// 시각은 늘 한국 시간(Asia/Seoul)으로 보인다. 사용자 PC 시간대와 상관없이 같은 글자.
describe('시각 표기', () => {
  it.each([
    ['2026-11-03T14:32:05+09:00', '14:32:05'],
    ['2026-11-03T05:02:09Z', '14:02:09'],
  ])('formatClock(%s) = %s', (iso, text) => {
    expect(formatClock(iso)).toBe(text);
  });

  it('formatClock은 Date도 받는다', () => {
    expect(formatClock(new Date('2026-11-03T00:00:01Z'))).toBe('09:00:01');
  });

  it.each([
    ['2026-11-03T13:58:10+09:00', '11월 3일 13:58'],
    ['2026-11-02T23:10:00-05:00', '11월 3일 13:10'],
  ])('formatDayTime(%s) = %s', (iso, text) => {
    expect(formatDayTime(iso)).toBe(text);
  });

  it.each([
    ['2026-11-02', '11월 2일(월)'],
    ['2026-11-01', '11월 1일(일)'],
  ])('formatDay(%s) = %s (날짜만 있는 값은 그 날짜 그대로)', (day, text) => {
    expect(formatDay(day)).toBe(text);
  });

  it.each([null, undefined, '', 'nope'])('값이 없거나 깨지면 — (%j)', (value) => {
    expect(formatClock(value)).toBe('—');
    expect(formatDayTime(value)).toBe('—');
    expect(formatDay(value)).toBe('—');
  });
});

describe('formatDuration (분석 단계 시간)', () => {
  it.each([
    [0, '0초'],
    [42.4, '42초'],
    [59.6, '1분'],
    [61, '1분 1초'],
    [412.4, '6분 52초'],
    [3600, '60분'],
  ])('%s초 → %s', (sec, text) => {
    expect(formatDuration(sec)).toBe(text);
  });

  it('값이 없으면 —', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(-1)).toBe('—');
  });
});
