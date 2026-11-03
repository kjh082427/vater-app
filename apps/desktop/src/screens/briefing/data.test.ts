import { describe, expect, it } from 'vitest';
import { parseIndices } from './data';

describe('parseIndices: 브리핑 수집 자료의 지수(data.indices)', () => {
  it('지수마다 이름·값·변화량·등락률과 최근 종가(오래된 것부터)', () => {
    const rows = parseIndices({
      indices: [
        {
          code: '0001',
          name: '코스피',
          value: 2583.27,
          change: 21.48,
          change_pct: 0.84,
          closes: [
            { day: '2026-10-30', close: 2550.1 },
            { day: '2026-10-31', close: 2561.79 },
          ],
        },
      ],
    });
    expect(rows).toEqual([
      {
        code: '0001',
        name: '코스피',
        value: 2583.27,
        change: 21.48,
        changePct: 0.84,
        closes: [2550.1, 2561.79],
      },
    ]);
  });

  it('숫자가 아닌 값은 null, 종가 목록의 숫자가 아닌 칸은 건너뛴다', () => {
    const rows = parseIndices({
      indices: [
        { code: 'X', name: 'X', value: '1', change: null, closes: [{ close: 'a' }, { close: 3 }] },
      ],
    });
    expect(rows).toEqual([
      { code: 'X', name: 'X', value: null, change: null, changePct: null, closes: [3] },
    ]);
  });

  it.each([undefined, null, {}, { indices: 'no' }, { indices: [null, 1] }])(
    '형식이 다르면 빈 목록 (%j)',
    (data) => {
      expect(parseIndices(data)).toEqual([]);
    },
  );
});
