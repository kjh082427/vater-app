import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { hrefOf, navigate, parseHash, useRoute, type Route } from './router';

describe('parseHash: 라우트 9개 (알림 클릭 경로와 같음)', () => {
  it.each<[string, Route]>([
    ['#/home', { name: 'home' }],
    ['#/analyses', { name: 'analyses' }],
    ['#/analyses/12', { name: 'analysis', id: 12 }],
    ['#/holdings', { name: 'holdings' }],
    ['#/alerts', { name: 'alerts' }],
    ['#/symbols/KR/005930', { name: 'symbol', market: 'KR', code: '005930' }],
    ['#/symbols/US/BRK.B', { name: 'symbol', market: 'US', code: 'BRK.B' }],
    ['#/briefings', { name: 'briefings' }],
    ['#/briefings/21', { name: 'briefing', id: 21 }],
    ['#/settings', { name: 'settings' }],
    ['#/welcome', { name: 'welcome' }],
  ])('%s', (hash, route) => {
    expect(parseHash(hash)).toEqual(route);
  });

  it.each(['', '#', '#/'])('빈 주소 %j는 홈', (hash) => {
    expect(parseHash(hash)).toEqual({ name: 'home' });
  });

  it('셸이 보내는 # 없는 경로도 읽는다', () => {
    expect(parseHash('/analyses/3')).toEqual({ name: 'analysis', id: 3 });
  });

  it('쿼리와 끝의 / 는 무시한다', () => {
    expect(parseHash('#/alerts/?x=1')).toEqual({ name: 'alerts' });
  });

  it.each([
    '#/analyses/abc',
    '#/analyses/0',
    '#/analyses/1.5',
    '#/symbols/JP/7203',
    '#/symbols/KR',
    '#/symbols/KR/005930/x',
    '#/symbols/KR/<script>',
    '#/nope',
  ])('맞지 않는 주소 %s는 notFound', (hash) => {
    expect(parseHash(hash).name).toBe('notFound');
  });
});

describe('hrefOf', () => {
  it.each<[Route, string]>([
    [{ name: 'home' }, '#/home'],
    [{ name: 'analysis', id: 7 }, '#/analyses/7'],
    [{ name: 'symbol', market: 'US', code: 'AAPL' }, '#/symbols/US/AAPL'],
    [{ name: 'briefing', id: 3 }, '#/briefings/3'],
  ])('%j → %s', (route, href) => {
    expect(hrefOf(route)).toBe(href);
    expect(parseHash(href)).toEqual(route);
  });
});

describe('navigate / useRoute', () => {
  it('주소의 #을 바꾸면 useRoute가 따라온다(hashchange는 비동기)', async () => {
    const { result } = renderHook(() => useRoute());
    expect(result.current).toEqual({ name: 'home' });
    act(() => navigate({ name: 'analysis', id: 5 }));
    expect(window.location.hash).toBe('#/analyses/5');
    await waitFor(() => expect(result.current).toEqual({ name: 'analysis', id: 5 }));
  });

  it('문자열 경로(셸 navigate 이벤트)로도 이동한다', async () => {
    const { result } = renderHook(() => useRoute());
    act(() => navigate('/symbols/KR/005930'));
    await waitFor(() =>
      expect(result.current).toEqual({ name: 'symbol', market: 'KR', code: '005930' }),
    );
  });
});

describe('홈 탭 쿼리 #/home?tab=<id>', () => {
  it('tab을 읽는다', () => {
    expect(parseHash('#/home?tab=d-1a2b')).toEqual({ name: 'home', tab: 'd-1a2b' });
    expect(parseHash('#/?tab=home')).toEqual({ name: 'home', tab: 'home' });
  });

  it('형식이 틀린 tab은 없는 것으로 본다', () => {
    expect(parseHash('#/home?tab=<x>')).toEqual({ name: 'home' });
    expect(parseHash('#/home?tab=')).toEqual({ name: 'home' });
    expect(parseHash('#/home?other=1')).toEqual({ name: 'home' });
  });

  it('hrefOf는 tab을 붙인다', () => {
    expect(hrefOf({ name: 'home', tab: 'd-1' })).toBe('#/home?tab=d-1');
    expect(hrefOf({ name: 'home' })).toBe('#/home');
  });
});
