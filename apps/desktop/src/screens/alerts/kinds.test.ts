import { describe, expect, it } from 'vitest';
import { alertKinds } from '../../mocks/fixtures';
import {
  formToParams,
  initialForm,
  kindLabel,
  paramFields,
  ruleSummary,
  TIMING_LABEL,
} from './kinds';

describe('규칙 요약(목록에 보이는 한 줄)', () => {
  it.each([
    ['price_above', { price: 71000 }, 'KR', '목표가 71,000원 이상'],
    ['price_below', { price: 180.5 }, 'US', '목표가 $180.50 이하'],
    ['change_pct', { pct: 5, direction: 'both' }, 'KR', '전일 대비 ±5% 이상 변동'],
    ['change_pct', { pct: 3.5, direction: 'up' }, 'KR', '전일 대비 +3.5% 이상 상승'],
    ['change_pct', { pct: 2, direction: 'down' }, 'KR', '전일 대비 −2% 이하 하락'],
    ['ma_cross', { fast: 5, slow: 20, direction: 'golden' }, 'KR', '5일·20일 이동평균 골든크로스'],
    ['ma_cross', { fast: 5, slow: 20, direction: 'dead' }, 'KR', '5일·20일 이동평균 데드크로스'],
    ['ma_break', { period: 20, direction: 'below' }, 'KR', '20일 이동평균 아래로 이탈'],
    [
      'rsi',
      { period: 14, upper: 70, lower: 30, direction: 'overbought' },
      'KR',
      'RSI(14) 70 이상 과매수 진입',
    ],
    [
      'rsi',
      { period: 14, upper: 70, lower: 30, direction: 'oversold' },
      'KR',
      'RSI(14) 30 이하 과매도 진입',
    ],
    [
      'macd_cross',
      { fast: 12, slow: 26, signal: 9, direction: 'golden' },
      'KR',
      'MACD(12·26·9) 시그널선 상향 교차',
    ],
    ['bollinger', { period: 20, k: 2, direction: 'upper' }, 'KR', '볼린저밴드(20일, 2σ) 상단 이탈'],
    ['volume_spike', { period: 20, multiple: 3 }, 'KR', '거래량이 20일 평균의 3배 이상'],
    ['new_high_low', { direction: 'low' }, 'KR', '52주 신저가 경신'],
  ])('%s %j (%s) → %s', (kind, params, market, text) => {
    expect(ruleSummary(kind, params, market)).toBe(text);
  });

  it('모르는 종류는 이름과 값을 그대로', () => {
    expect(ruleSummary('future_kind', { x: 1 }, 'KR')).toBe('future_kind (x: 1)');
  });
});

describe('규칙 편집 폼', () => {
  const kind = (k: string) => {
    const found = alertKinds.find((x) => x.kind === k);
    if (!found) throw new Error(k);
    return found;
  };

  it('종류 이름과 확인 시점 이름', () => {
    expect(kindLabel('rsi')).toBe('RSI 과매수·과매도');
    expect(TIMING_LABEL.realtime).toBe('장중 실시간(잠정)');
    expect(TIMING_LABEL.close).toBe('장 마감 후(확정 일봉)');
  });

  it('필수 값(목표가)은 빈 칸, 나머지는 기본값으로 채운다', () => {
    expect(initialForm(kind('price_above'))).toEqual({ price: '' });
    expect(initialForm(kind('rsi'))).toEqual({
      period: '14',
      upper: '70',
      lower: '30',
      direction: 'overbought',
    });
  });

  it('목표가 칸은 시장의 통화 단위를 단다', () => {
    const [kr] = paramFields(kind('price_above'), 'KR');
    const [us] = paramFields(kind('price_above'), 'US');
    expect(kr).toMatchObject({
      name: 'price',
      label: '목표가(원)',
      type: 'number',
      required: true,
    });
    expect(us).toMatchObject({ label: '목표가($)' });
  });

  it('방향은 선택지', () => {
    const fields = paramFields(kind('ma_cross'), 'KR');
    expect(fields.find((f) => f.name === 'direction')).toMatchObject({
      type: 'select',
      options: [
        { value: 'golden', label: '골든크로스(상향 교차)' },
        { value: 'dead', label: '데드크로스(하향 교차)' },
      ],
    });
  });

  it('폼 값 → API params: 숫자로 바꾸고, 필수 빈 칸과 숫자가 아닌 칸은 오류', () => {
    expect(
      formToParams(kind('rsi'), { period: '14', upper: '75', lower: '25', direction: 'oversold' }),
    ).toEqual({ ok: true, params: { period: 14, upper: 75, lower: 25, direction: 'oversold' } });
    expect(formToParams(kind('price_above'), { price: '' })).toEqual({
      ok: false,
      errors: { price: '목표가를 입력하세요.' },
    });
    expect(formToParams(kind('price_above'), { price: '7만' })).toEqual({
      ok: false,
      errors: { price: '숫자로 입력하세요.' },
    });
    expect(formToParams(kind('price_above'), { price: '71,500' })).toEqual({
      ok: true,
      params: { price: 71500 },
    });
  });
});
