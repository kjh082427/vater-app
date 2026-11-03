/**
 * 시각 표기. 사이드카 시각(ISO 8601, 시간대 포함)을 한국 시간으로 보인다(사용자는 국내 투자자).
 * 숫자(금액·등락률)는 여기서 다루지 않는다: design-system의 format/money.ts만 쓴다.
 */
import { MISSING } from '../../design-system';

const ZONE = 'Asia/Seoul';
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

function parts(date: Date): Record<string, string> {
  const out: Record<string, string> = {};
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
  return out;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `14:32:05` */
export function formatClock(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return MISSING;
  const p = parts(date);
  return `${p.hour}:${p.minute}:${p.second}`;
}

/** `11월 3일 13:58` */
export function formatDayTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return MISSING;
  const p = parts(date);
  return `${p.month}월 ${p.day}일 ${p.hour}:${p.minute}`;
}

/** 날짜만 있는 값(`2026-11-02`, 시장 날짜) → `11월 2일(월)`. 시간대를 바꾸지 않는다. */
export function formatDay(value: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!m) return MISSING;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const weekday = WEEKDAY[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  return `${mo}월 ${d}일(${weekday})`;
}

/** 걸린 시간(초) → `6분 52초`, `42초`. */
export function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return MISSING;
  const total = Math.round(seconds);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  if (min === 0) return `${sec}초`;
  return sec === 0 ? `${min}분` : `${min}분 ${sec}초`;
}

/** `07:00` */
export function formatHm(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return MISSING;
  const p = parts(date);
  return `${p.hour}:${p.minute}`;
}
