/**
 * 해시 라우터(의존성 없음). 경로는 셸의 알림 클릭 경로(`navigate {route}`)와 같다(스펙 9-3):
 * 가격 알림 → `/symbols/<market>/<code>`(그 종목의 감시·알림), 분석 완료 → `/analyses/<id>`,
 * 브리핑 → `/briefings/<id>`.
 */
import { useSyncExternalStore } from 'react';
import type { MarketCode } from '../api/types';

export type Route =
  /** tab: 홈 대시보드 탭 id(`#/home?tab=<id>`). 없으면 첫 탭. */
  | { name: 'home'; tab?: string }
  | { name: 'analyses' }
  | { name: 'analysis'; id: number }
  | { name: 'holdings' }
  | { name: 'alerts' }
  | { name: 'symbol'; market: MarketCode; code: string }
  | { name: 'briefings' }
  | { name: 'briefing'; id: number }
  | { name: 'settings' }
  | { name: 'welcome' }
  | { name: 'notFound'; path: string };

const SIMPLE = {
  home: { name: 'home' },
  analyses: { name: 'analyses' },
  holdings: { name: 'holdings' },
  alerts: { name: 'alerts' },
  briefings: { name: 'briefings' },
  settings: { name: 'settings' },
  welcome: { name: 'welcome' },
} as const satisfies Record<string, Route>;

const ID = /^[1-9]\d{0,9}$/;
const CODE = /^[A-Za-z0-9.-]{1,12}$/;
const TAB = /^[\w-]{1,40}$/;

function homeOf(query: string): Route {
  const tab = new URLSearchParams(query).get('tab');
  return tab !== null && TAB.test(tab) ? { name: 'home', tab } : SIMPLE.home;
}

/** `#/analyses/3`, `/analyses/3`, `` 모두 읽는다. 맞지 않으면 notFound. */
export function parseHash(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  const [head, a, b, ...rest] = parts;
  if (head === undefined || (head === 'home' && a === undefined)) return homeOf(query);
  const notFound: Route = { name: 'notFound', path };
  if (rest.length > 0) return notFound;
  if (a === undefined && head in SIMPLE) return SIMPLE[head as keyof typeof SIMPLE];
  if (b === undefined && a !== undefined && ID.test(a)) {
    if (head === 'analyses') return { name: 'analysis', id: Number(a) };
    if (head === 'briefings') return { name: 'briefing', id: Number(a) };
  }
  if (head === 'symbols' && (a === 'KR' || a === 'US') && b !== undefined && CODE.test(b)) {
    return { name: 'symbol', market: a, code: b };
  }
  return notFound;
}

export function hrefOf(route: Route): string {
  switch (route.name) {
    case 'analysis':
      return `#/analyses/${route.id}`;
    case 'briefing':
      return `#/briefings/${route.id}`;
    case 'symbol':
      return `#/symbols/${route.market}/${encodeURIComponent(route.code)}`;
    case 'notFound':
      return `#/${route.path.replace(/^\//, '')}`;
    case 'home':
      return route.tab ? `#/home?tab=${encodeURIComponent(route.tab)}` : '#/home';
    default:
      return `#/${route.name}`;
  }
}

/** 화면 이동. 문자열은 셸이 보낸 경로(`/analyses/3`)나 `#/...`. */
export function navigate(to: Route | string): void {
  const href = typeof to === 'string' ? `#${to.replace(/^#/, '')}` : hrefOf(to);
  if (window.location.hash !== href) window.location.hash = href;
}

function subscribe(notify: () => void) {
  window.addEventListener('hashchange', notify);
  return () => window.removeEventListener('hashchange', notify);
}

/** 지금 주소의 라우트. 같은 주소면 같은 문자열이라 다시 그리지 않는다. */
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parseHash(hash);
}
