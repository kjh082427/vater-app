/**
 * 브리핑 수집 자료(BriefingDetail.data, 사이드카 briefing/collect.py) 읽기.
 * data는 명세상 형식이 없는 객체라 여기서 하나씩 확인하며 읽는다. 숫자는 데이터에서만 나온다(D9).
 */

export interface IndexRow {
  code: string;
  name: string;
  value: number | null;
  change: number | null;
  /** 퍼센트 값(0.84 = 0.84%). */
  changePct: number | null;
  /** 최근 종가, 오래된 것부터. */
  closes: number[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function quote(row: Record<string, unknown>) {
  return {
    code: str(row.code),
    name: str(row.name),
    value: num(row.value),
    change: num(row.change),
    changePct: num(row.change_pct),
  };
}

export function parseIndices(data: unknown): IndexRow[] {
  if (!isRecord(data) || !Array.isArray(data.indices)) return [];
  return data.indices.filter(isRecord).map((row) => ({
    code: str(row.code),
    name: str(row.name),
    value: num(row.value),
    change: num(row.change),
    changePct: num(row.change_pct),
    closes: (Array.isArray(row.closes) ? row.closes : [])
      .map((c) => (isRecord(c) ? num(c.close) : null))
      .filter((c): c is number => c !== null),
  }));
}

/** 빠진 항목 이름(사이드카 missing 값) → 화면 이름. */
export const MISSING_LABEL: Record<string, string> = {
  indices: '지수',
  sectors: '업종',
  movers: '상위 종목',
  flows: '수급',
  watchlist: '감시 종목',
  alerts: '알림',
  interpretation: 'AI 해석',
};

export const missingLabel = (key: string) => MISSING_LABEL[key] ?? key;

/** 국내 시장 이름(사이드카 DomesticMarket). */
export const DOMESTIC_LABEL: Record<string, string> = { KOSPI: '코스피', KOSDAQ: '코스닥' };
const domesticOrder = (m: string) => (m === 'KOSPI' ? 0 : m === 'KOSDAQ' ? 1 : 2);

function byMarket(value: unknown): [string, Record<string, unknown>][] {
  if (!isRecord(value)) return [];
  return Object.entries(value)
    .filter((e): e is [string, Record<string, unknown>] => isRecord(e[1]))
    .sort((a, b) => domesticOrder(a[0]) - domesticOrder(b[0]));
}

export interface SectorQuote {
  code: string;
  name: string;
  value: number | null;
  change: number | null;
  changePct: number | null;
}

export interface SectorBoard {
  market: string;
  label: string;
  advancers: number | null;
  decliners: number | null;
  unchanged: number | null;
  /** 등락률 높은 순. */
  sectors: SectorQuote[];
}

/** 업종(국내): 시장마다 상승·하락·보합 종목 수와 업종 지수. */
export function parseSectors(data: unknown): SectorBoard[] {
  if (!isRecord(data)) return [];
  return byMarket(data.sectors).map(([market, board]) => ({
    market,
    label: DOMESTIC_LABEL[market] ?? market,
    advancers: num(board.advancers),
    decliners: num(board.decliners),
    unchanged: num(board.unchanged),
    sectors: (Array.isArray(board.sectors) ? board.sectors : [])
      .filter(isRecord)
      .map(quote)
      .sort((a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity)),
  }));
}

export interface RankRow {
  rank: number | null;
  code: string;
  name: string;
  /** 원. */
  price: number | null;
  changePct: number | null;
  /** 거래대금(원). */
  tradingValue: number | null;
}

export interface Movers {
  up: RankRow[];
  down: RankRow[];
  value: RankRow[];
}

function ranks(value: unknown): RankRow[] {
  return (Array.isArray(value) ? value : [])
    .filter(isRecord)
    .map((r) => ({
      rank: num(r.rank),
      code: str(r.code),
      name: str(r.name),
      price: num(r.price),
      changePct: num(r.change_pct),
      tradingValue: num(r.trading_value),
    }))
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
}

/** 등락률 상승·하락 상위와 거래대금 상위(국내). */
export function parseMovers(data: unknown): Movers {
  const m = isRecord(data) && isRecord(data.movers) ? data.movers : {};
  return { up: ranks(m.up), down: ranks(m.down), value: ranks(m.value) };
}

export interface FlowRow {
  market: string;
  label: string;
  /** 순매수 금액(원). 사이드카는 백만원으로 주므로 1,000,000을 곱했다. */
  foreign: number | null;
  institution: number | null;
  individual: number | null;
}

/** 사이드카 수급 단위(백만원) → 원. formatEokChange는 원을 받는다. */
const MILLION_WON = 1_000_000;
const won = (v: unknown) => {
  const n = num(v);
  return n === null ? null : n * MILLION_WON;
};

/** 투자자 수급(국내): 외국인·기관·개인 순매수. */
export function parseFlows(data: unknown): FlowRow[] {
  if (!isRecord(data)) return [];
  return byMarket(data.flows).map(([market, f]) => ({
    market,
    label: DOMESTIC_LABEL[market] ?? market,
    foreign: won(f.foreign),
    institution: won(f.institution),
    individual: won(f.individual),
  }));
}

export interface WatchRow {
  code: string;
  name: string;
  price: number | null;
  changePct: number | null;
}

/** 내 감시 종목의 그날 종가·등락률. */
export function parseWatch(data: unknown): WatchRow[] {
  if (!isRecord(data) || !Array.isArray(data.watchlist)) return [];
  return data.watchlist.filter(isRecord).map((w) => ({
    code: str(w.code),
    name: str(w.name),
    price: num(w.price),
    changePct: num(w.change_pct),
  }));
}

export interface DayAlert {
  firedAt: string;
  name: string;
  kind: string;
  message: string;
}

/** 그날 울린 알림. */
export function parseDayAlerts(data: unknown): DayAlert[] {
  if (!isRecord(data) || !Array.isArray(data.alerts)) return [];
  return data.alerts.filter(isRecord).map((a) => ({
    firedAt: str(a.fired_at),
    name: str(a.name),
    kind: str(a.kind),
    message: str(a.message),
  }));
}
