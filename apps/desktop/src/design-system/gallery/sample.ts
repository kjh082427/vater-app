/**
 * 견본용 예시 데이터. 방향 B 시안과 같은 장면: 2026-11-03(화) 14:32, 국내 장중.
 * 시세, 문장, 알림은 모두 지어낸 값이다. 실제 데이터로 쓰지 않는다.
 */
import type { Currency } from '../format/money';
import type { FeedState } from '../components/FeedStatus';
import type { Market } from '../components/MarketState';

export interface WatchRow {
  market: Market;
  code: string;
  name: string;
  currency: Currency;
  price: number;
  change: number;
  changePct: number;
  feed: FeedState;
  pollSeconds?: number;
}

export const watchlist: WatchRow[] = [
  {
    market: 'KR',
    code: '005930',
    name: '삼성전자',
    currency: 'KRW',
    price: 71400,
    change: 1200,
    changePct: 1.71,
    feed: 'live',
  },
  {
    market: 'KR',
    code: '000660',
    name: 'SK하이닉스',
    currency: 'KRW',
    price: 198700,
    change: -3300,
    changePct: -1.63,
    feed: 'polling',
    pollSeconds: 30,
  },
  {
    market: 'KR',
    code: '035420',
    name: 'NAVER',
    currency: 'KRW',
    price: 172300,
    change: 0,
    changePct: 0,
    feed: 'live',
  },
  {
    market: 'US',
    code: 'AAPL',
    name: '애플',
    currency: 'USD',
    price: 227.48,
    change: 2.13,
    changePct: 0.95,
    feed: 'closed',
  },
  {
    market: 'US',
    code: 'NVDA',
    name: '엔비디아',
    currency: 'USD',
    price: 135.4,
    change: -1.87,
    changePct: -1.36,
    feed: 'closed',
  },
];

// 시안 B의 미니 차트 모양을 그대로 되살린 최근 30일 종가(지어낸 값)
const kospiShape = [
  19.7, 20.1, 18.0, 18.3, 19.0, 21.7, 22.0, 17.8, 15.9, 12.0, 10.7, 9.0, 7.9, 13.2, 9.8, 7.7, 5.6,
  10.9, 16.4, 19.0, 20.2, 18.7, 18.5, 16.3, 18.0, 16.6, 14.8, 16.6, 7.9, 2.0,
];
const kosdaqShape = [
  3.6, 8.5, 7.8, 4.8, 7.2, 12.5, 13.3, 12.2, 8.8, 13.7, 18.9, 16.9, 15.8, 11.0, 8.1, 9.0, 10.5, 2.0,
  3.6, 6.9, 11.5, 11.8, 11.8, 13.6, 14.4, 14.0, 12.1, 8.8, 19.6, 22.0,
];

export interface IndexRow {
  name: string;
  close: number;
  change: number;
  changePct: number;
  closes: number[];
}

export const indices: IndexRow[] = [
  {
    name: '코스피',
    close: 2583.27,
    change: 21.48,
    changePct: 0.84,
    closes: kospiShape.map((y) => Math.round((2583.27 - (y - 2) * 6) * 100) / 100),
  },
  {
    name: '코스닥',
    close: 742.15,
    change: -2.76,
    changePct: -0.37,
    closes: kosdaqShape.map((y) => Math.round((742.15 + (22 - y) * 1.2) * 100) / 100),
  },
];

/** 코스피 수급(원). 사이드카는 백만원 단위로 주므로 화면에서 1e6을 곱한다. */
export const flows = {
  foreign: 312_400_000_000,
  institution: -98_700_000_000,
  individual: -201_300_000_000,
};

export const brief = {
  lead: '반도체 대형주가 지수를 끌어올렸지만, 코스닥은 2차전지 약세에 밀렸습니다.',
  more: '외국인 매수가 대형 반도체주에 몰렸고, 개인은 차익 실현에 나섰습니다.',
  usLead: '금리 인하 기대가 이어지며 대형 기술주 중심으로 올랐습니다.',
};

export const analysisSummary = [
  '메모리 가격 반등이 2분기 연속 이어질 가능성이 높다고 봤습니다.',
  '다만 환율 변동과 재고 부담을 근거로 한꺼번에 사기보다 나눠서 늘리는 편이 낫다고 판단했습니다.',
  '리스크 토론에서는 3거래일 연속 외국인 순매수가 꺾일 때를 다시 볼 시점으로 꼽았습니다.',
];
