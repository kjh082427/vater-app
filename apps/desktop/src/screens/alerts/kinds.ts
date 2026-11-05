/**
 * 알림 규칙 종류(스펙 4-1)의 화면 정보: 이름, 파라미터 칸, 한 줄 요약.
 * `GET /alerts/kinds`는 종류·기본값·필수 항목·기본 확인 시점만 준다. 이름과 방향 선택지는
 * 사이드카 `alerts/rules.py`의 파라미터 모델을 옮긴 것이다. 모르는 종류가 오면 이름과 값을 그대로 쓴다.
 */
import type { AlertKindInfo } from '../../api/types';
import { formatNumber, formatPrice, MINUS } from '../../design-system';
import { currencyOf } from '../common/quotes';

export type Timing = 'realtime' | 'close';

export const TIMING_LABEL: Record<Timing, string> = {
  realtime: '장중 실시간',
  close: '장 마감 후(그날 종가)',
};

interface Option {
  value: string;
  label: string;
}

const DIRECTION: Record<string, Option[]> = {
  change_pct: [
    { value: 'both', label: '상승·하락 모두' },
    { value: 'up', label: '상승' },
    { value: 'down', label: '하락' },
  ],
  ma_cross: [
    { value: 'golden', label: '골든크로스(상향 교차)' },
    { value: 'dead', label: '데드크로스(하향 교차)' },
  ],
  macd_cross: [
    { value: 'golden', label: '골든크로스(상향 교차)' },
    { value: 'dead', label: '데드크로스(하향 교차)' },
  ],
  ma_break: [
    { value: 'above', label: '위로 돌파' },
    { value: 'below', label: '아래로 이탈' },
  ],
  rsi: [
    { value: 'overbought', label: '과매수 진입' },
    { value: 'oversold', label: '과매도 진입' },
  ],
  bollinger: [
    { value: 'upper', label: '상단 이탈' },
    { value: 'lower', label: '하단 이탈' },
  ],
  new_high_low: [
    { value: 'high', label: '52주 신고가' },
    { value: 'low', label: '52주 신저가' },
  ],
  avg_price_pct: [
    { value: 'down', label: '평단가보다 하락' },
    { value: 'up', label: '평단가보다 상승' },
  ],
};

const KIND_LABEL: Record<string, string> = {
  price_above: '목표가 이상',
  price_below: '목표가 이하',
  change_pct: '전일 대비 등락률',
  ma_cross: '이동평균선 교차',
  ma_break: '이동평균선 돌파·이탈',
  rsi: 'RSI 과매수·과매도',
  macd_cross: 'MACD 시그널선 교차',
  bollinger: '볼린저밴드 이탈',
  volume_spike: '거래량 급증',
  new_high_low: '52주 신고가·신저가',
  avg_price_pct: '평단가 대비 ±N%',
};

/** 선택 목록의 묶음(스펙 4-1의 분류). */
export const KIND_GROUP: Record<string, string> = {
  price_above: '가격',
  price_below: '가격',
  change_pct: '가격',
  ma_cross: '추세',
  ma_break: '추세',
  rsi: '모멘텀',
  macd_cross: '모멘텀',
  bollinger: '변동성',
  volume_spike: '거래량',
  new_high_low: '신고가',
  avg_price_pct: '내 보유',
};

export const kindLabel = (kind: string) => KIND_LABEL[kind] ?? kind;

const PARAM_LABEL: Record<string, Record<string, string>> = {
  change_pct: { pct: '등락률 기준(%)', direction: '방향' },
  ma_cross: { fast: '짧은 이동평균(일)', slow: '긴 이동평균(일)', direction: '교차' },
  ma_break: { period: '이동평균 기간(일)', direction: '방향' },
  rsi: { period: '기간(일)', upper: '과매수 기준', lower: '과매도 기준', direction: '조건' },
  macd_cross: {
    fast: '빠른 EMA(일)',
    slow: '느린 EMA(일)',
    signal: '시그널(일)',
    direction: '교차',
  },
  bollinger: { period: '기간(일)', k: '표준편차 배수(σ)', direction: '방향' },
  volume_spike: { period: '평균 기간(일)', multiple: '평균 대비 배수' },
  new_high_low: { direction: '조건' },
  avg_price_pct: { pct: '평단가 대비(%)', direction: '방향' },
};

export interface ParamField {
  name: string;
  label: string;
  type: 'number' | 'select' | 'text';
  required: boolean;
  options?: Option[];
}

/** 종류의 파라미터 칸. 필수 항목(목표가)이 앞, 기본값이 있는 항목은 그 순서대로. */
export function paramFields(kind: AlertKindInfo, market: string): ParamField[] {
  const names = [
    ...kind.required,
    ...Object.keys(kind.params).filter((n) => !kind.required.includes(n)),
  ];
  return names.map((name) => {
    const required = kind.required.includes(name);
    if (name === 'direction' && DIRECTION[kind.kind]) {
      return {
        name,
        label: PARAM_LABEL[kind.kind]?.direction ?? '방향',
        type: 'select',
        required,
        options: DIRECTION[kind.kind],
      };
    }
    if (name === 'price') {
      return {
        name,
        label: currencyOf(market) === 'USD' ? '목표가($)' : '목표가(원)',
        type: 'number',
        required,
      };
    }
    const sample = kind.params[name];
    const type = required || typeof sample === 'number' ? 'number' : 'text';
    return { name, label: PARAM_LABEL[kind.kind]?.[name] ?? name, type, required };
  });
}

export type FormValues = Record<string, string>;

/** 편집 폼의 처음 값. 필수 항목은 빈 칸, 나머지는 기본값. 수정할 때는 저장된 값. */
export function initialForm(kind: AlertKindInfo, saved?: Record<string, unknown>): FormValues {
  const out: FormValues = {};
  for (const name of kind.required)
    out[name] = saved?.[name] === undefined ? '' : String(saved[name]);
  for (const [name, value] of Object.entries(kind.params)) {
    const v = saved?.[name] ?? value;
    out[name] = v === null || v === undefined ? '' : String(v);
  }
  return out;
}

export type ParseResult =
  { ok: true; params: Record<string, unknown> } | { ok: false; errors: Record<string, string> };

/** 폼 값 → API params. 숫자 칸은 천 단위 쉼표를 빼고 숫자로. 범위 검사는 사이드카가 한다(422 hint). */
export function formToParams(kind: AlertKindInfo, values: FormValues): ParseResult {
  const params: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const field of paramFields(kind, 'KR')) {
    const raw = (values[field.name] ?? '').trim();
    if (raw === '') {
      if (field.required) {
        errors[field.name] = `${field.name === 'price' ? '목표가' : field.label}를 입력하세요.`;
      }
      continue;
    }
    if (field.type === 'number') {
      const n = Number(raw.replace(/,/g, ''));
      if (!Number.isFinite(n)) {
        errors[field.name] = '숫자로 입력하세요.';
        continue;
      }
      params[field.name] = n;
    } else {
      params[field.name] = raw;
    }
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, params };
}

/** 기준값 숫자: 필요한 만큼만 소수(최대 2자리). */
function plain(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  const decimals = Number.isInteger(n) ? 0 : Number.isInteger(n * 10) ? 1 : 2;
  return formatNumber(n, decimals);
}

/** 목록에 보이는 규칙 한 줄. 예: "목표가 71,000원 이상", "RSI(14) 70 이상 과매수 진입". */
export function ruleSummary(kind: string, params: Record<string, unknown>, market: string): string {
  const p = params;
  const currency = currencyOf(market);
  switch (kind) {
    case 'price_above':
      return `목표가 ${formatPrice(Number(p.price), currency)} 이상`;
    case 'price_below':
      return `목표가 ${formatPrice(Number(p.price), currency)} 이하`;
    case 'change_pct':
      if (p.direction === 'up') return `전일 대비 +${plain(p.pct)}% 이상 상승`;
      if (p.direction === 'down') return `전일 대비 ${MINUS}${plain(p.pct)}% 이하 하락`;
      return `전일 대비 ±${plain(p.pct)}% 이상 변동`;
    case 'ma_cross':
      return `${plain(p.fast)}일·${plain(p.slow)}일 이동평균 ${p.direction === 'dead' ? '데드크로스' : '골든크로스'}`;
    case 'ma_break':
      return `${plain(p.period)}일 이동평균 ${p.direction === 'below' ? '아래로 이탈' : '위로 돌파'}`;
    case 'rsi':
      return p.direction === 'oversold'
        ? `RSI(${plain(p.period)}) ${plain(p.lower)} 이하 과매도 진입`
        : `RSI(${plain(p.period)}) ${plain(p.upper)} 이상 과매수 진입`;
    case 'macd_cross':
      return `MACD(${plain(p.fast)}·${plain(p.slow)}·${plain(p.signal)}) 시그널선 ${p.direction === 'dead' ? '하향' : '상향'} 교차`;
    case 'bollinger':
      return `볼린저밴드(${plain(p.period)}일, ${plain(p.k)}σ) ${p.direction === 'lower' ? '하단' : '상단'} 이탈`;
    case 'volume_spike':
      return `거래량이 ${plain(p.period)}일 평균의 ${plain(p.multiple)}배 이상`;
    case 'avg_price_pct':
      return p.direction === 'up'
        ? `내 평단가 대비 +${plain(p.pct)}% 이상 상승`
        : `내 평단가 대비 ${MINUS}${plain(p.pct)}% 이하 하락`;
    case 'new_high_low':
      return `52주 ${p.direction === 'low' ? '신저가' : '신고가'} 경신`;
    default: {
      const values = Object.entries(p).map(([k, v]) => `${k}: ${String(v)}`);
      return values.length > 0 ? `${kind} (${values.join(', ')})` : kind;
    }
  }
}
