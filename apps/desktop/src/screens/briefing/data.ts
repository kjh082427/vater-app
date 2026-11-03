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
