import { describe, expect, it } from 'vitest';
import { formatEokChange } from '../../design-system';
import {
  parseDayAlerts,
  parseFlows,
  parseIndices,
  parseMovers,
  parseSectors,
  parseWatch,
} from './data';

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

describe('parseFlows: 투자자 수급(사이드카 단위 백만원 → 원)', () => {
  it('백만원을 원으로 바꿔 formatEokChange에 그대로 넘길 수 있게 한다', () => {
    const rows = parseFlows({
      flows: {
        KOSPI: { day: '2026-11-02', foreign: 312400, institution: -152000, individual: 40 },
      },
    });
    expect(rows).toEqual([
      {
        market: 'KOSPI',
        label: '코스피',
        foreign: 312_400_000_000,
        institution: -152_000_000_000,
        individual: 40_000_000,
      },
    ]);
    expect(formatEokChange(rows[0]?.foreign)).toBe('+3,124억');
    expect(formatEokChange(rows[0]?.institution)).toBe('−1,520억');
    expect(formatEokChange(rows[0]?.individual)).toBe('+0.4억');
  });

  it('값이 숫자가 아니면 null', () => {
    expect(parseFlows({ flows: { KOSDAQ: { foreign: 'x' } } })[0]).toMatchObject({
      label: '코스닥',
      foreign: null,
      institution: null,
    });
  });

  it('자료가 없으면 빈 목록', () => {
    expect(parseFlows({})).toEqual([]);
  });
});

describe('parseSectors: 업종(상승·하락 종목 수)', () => {
  it('시장마다 상승·하락·보합 수와 업종(등락률 높은 순)', () => {
    const [kospi] = parseSectors({
      sectors: {
        KOSPI: {
          index: { name: '코스피', value: 1, change: 1, change_pct: 1 },
          advancers: 512,
          decliners: 318,
          unchanged: 76,
          sectors: [
            { code: 'a', name: '음식료품', value: 3820.5, change: -21, change_pct: -0.55 },
            { code: 'b', name: '전기전자', value: 31244.1, change: 701.2, change_pct: 2.3 },
          ],
        },
      },
    });
    expect(kospi).toMatchObject({ label: '코스피', advancers: 512, decliners: 318, unchanged: 76 });
    expect(kospi?.sectors.map((s) => s.name)).toEqual(['전기전자', '음식료품']);
  });
});

describe('parseMovers: 등락률·거래대금 상위', () => {
  it('세 목록, 순위 순', () => {
    const m = parseMovers({
      movers: {
        up: [
          { rank: 2, code: 'b', name: 'B', price: 2, change_pct: 10, trading_value: 5 },
          { rank: 1, code: 'a', name: 'A', price: 1, change_pct: 20, trading_value: 6 },
        ],
        down: [],
        value: [{ rank: 1, code: 'c', name: 'C', price: 3, change_pct: -1, trading_value: 1e12 }],
      },
    });
    expect(m.up.map((r) => r.code)).toEqual(['a', 'b']);
    expect(m.value[0]).toMatchObject({ code: 'c', tradingValue: 1e12, changePct: -1 });
    expect(m.down).toEqual([]);
  });
});

describe('parseWatch·parseDayAlerts', () => {
  it('감시 종목과 그날 알림', () => {
    expect(
      parseWatch({
        watchlist: [{ code: '005930', name: '삼성전자', price: 71400, change_pct: 1.71 }],
      }),
    ).toEqual([{ code: '005930', name: '삼성전자', price: 71400, changePct: 1.71 }]);
    expect(
      parseDayAlerts({ alerts: [{ fired_at: 't', name: 'n', kind: 'rsi', message: 'm' }] }),
    ).toEqual([{ firedAt: 't', name: 'n', kind: 'rsi', message: 'm' }]);
  });
});
