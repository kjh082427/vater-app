import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { errorResponse } from '../mocks/handlers';
import { FakeEventSource } from '../test/FakeEventSource';
import { emit, renderWithServices } from '../test/render';
import { mock, server } from '../test/server';
import { App } from './App';

function renderApp(hash = '#/home', retryDelaysMs?: number[]) {
  window.location.hash = hash;
  return renderWithServices(<App />, { retryDelaysMs });
}

const sidebar = () => screen.getByRole('navigation', { name: '주 메뉴' });
const statusBar = () => screen.getByRole('contentinfo', { name: '상태' });

describe('앱 틀', () => {
  it('사이드바 5개 메뉴와 지금 화면 표시', async () => {
    renderApp('#/alerts');
    const links = within(sidebar()).getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual(['홈', '분석', '감시·알림', '브리핑', '설정']);
    expect(within(sidebar()).getByRole('link', { name: '감시·알림' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(sidebar()).getByRole('link', { name: '분석' })).toHaveAttribute(
      'href',
      '#/analyses',
    );
  });

  it.each([
    ['#/home', '홈', '홈'],
    ['#/analyses', '분석', '분석'],
    ['#/analyses/7', '삼성전자 분석', '분석'],
    ['#/alerts', '감시·알림', '감시·알림'],
    ['#/symbols/KR/005930', '감시·알림', '감시·알림'],
    ['#/briefings', '브리핑', '브리핑'],
    ['#/briefings/21', '11월 2일(월) 국내 시장 브리핑', '브리핑'],
    ['#/settings', '설정', '설정'],
  ])('%s → 화면 %s, 사이드바 %s', async (hash, title, nav) => {
    renderApp(hash);
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(within(sidebar()).getByRole('link', { name: nav })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('없는 주소는 안내와 홈으로 가는 링크', async () => {
    renderApp('#/nope');
    expect(
      await screen.findByRole('heading', { level: 1, name: '화면을 찾을 수 없습니다' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '홈으로' })).toHaveAttribute('href', '#/home');
  });

  it('마법사(#/welcome)는 사이드바 없이 연다', async () => {
    renderApp('#/welcome');
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '주 메뉴' })).not.toBeInTheDocument();
  });
});

describe('셸 navigate 이벤트(알림 클릭)', () => {
  it('경로로 이동한다', async () => {
    const { shell } = renderApp('#/home');
    act(() => shell.navigate('/analyses/7'));
    await waitFor(() => expect(window.location.hash).toBe('#/analyses/7'));
    act(() => shell.navigate('/symbols/US/AAPL'));
    await waitFor(() => expect(window.location.hash).toBe('#/symbols/US/AAPL'));
  });

  it('모르는 경로는 무시한다', async () => {
    const { shell } = renderApp('#/home');
    act(() => shell.navigate('/evil/../x'));
    await new Promise((r) => setTimeout(r, 10));
    expect(window.location.hash).toBe('#/home');
  });
});

describe('첫 실행 마법사로 보내기', () => {
  it('한투 앱키가 없으면 #/welcome', async () => {
    mock.db.secrets.KIS_APP_KEY = false;
    renderApp('#/home');
    await waitFor(() => expect(window.location.hash).toBe('#/welcome'));
  });

  it('앱키가 있으면 그대로', async () => {
    renderApp('#/home');
    await screen.findByRole('heading', { level: 1, name: '홈' });
    await new Promise((r) => setTimeout(r, 30));
    expect(window.location.hash).toBe('#/home');
  });

  it('비밀키 상태를 못 읽으면(연결 실패) 보내지 않는다', async () => {
    server.use(http.get('*/secrets', () => HttpResponse.error()));
    renderApp('#/home');
    await new Promise((r) => setTimeout(r, 30));
    expect(window.location.hash).toBe('#/home');
  });
});

describe('오프라인 배너', () => {
  it('SSE가 끊기면 배너, 다시 연결되면 사라진다', async () => {
    const { stream } = renderApp();
    const source = await stream();
    expect(screen.queryByText(/연결 끊김/)).not.toBeInTheDocument();
    act(() => source.fail());
    expect(await screen.findByText(/연결 끊김/)).toBeInTheDocument();
    await waitFor(() => expect(FakeEventSource.all).toHaveLength(2));
    act(() => FakeEventSource.latest.open());
    await waitFor(() => expect(screen.queryByText(/연결 끊김/)).not.toBeInTheDocument());
  });

  it('[지금 다시 연결]은 기다리지 않고 다시 연결한다', async () => {
    const { stream } = renderApp('#/home', [60_000]);
    const source = await stream();
    act(() => source.fail());
    await userEvent.click(await screen.findByRole('button', { name: '지금 다시 연결' }));
    await waitFor(() => expect(FakeEventSource.all).toHaveLength(2));
  });

  it('SSE가 끊긴 동안 사이드바·상태 표시줄은 감시 상태를 주장하지 않는다', async () => {
    const { stream } = renderApp('#/home', [60_000]);
    const source = await stream();
    const side = screen.getByRole('complementary');
    await within(side).findByText('알림 감시 중');
    await within(statusBar()).findByText('실시간 1 · 폴링 1');
    act(() => source.fail());
    expect(await within(side).findByText('감시 상태 확인 불가')).toBeInTheDocument();
    expect(within(side).queryByText('알림 감시 중')).not.toBeInTheDocument();
    expect(within(side).getByRole('button', { name: '감시 일시 중지' })).toBeDisabled();
    expect(within(statusBar()).getByText('확인 불가 · 다시 연결 중')).toBeInTheDocument();
    expect(within(statusBar()).queryByText('실시간 1 · 폴링 1')).not.toBeInTheDocument();
  });

  it('감시 상태가 offline이면 "오프라인: 알림 감시 일시 중지"', async () => {
    const { stream } = renderApp();
    const source = await stream();
    emit(source, 'alerts.state', { ...mock.db.monitor, state: 'offline' });
    expect(await screen.findByText('오프라인: 알림 감시 일시 중지')).toBeInTheDocument();
    emit(source, 'alerts.state', { ...mock.db.monitor, state: 'running' });
    await waitFor(() =>
      expect(screen.queryByText('오프라인: 알림 감시 일시 중지')).not.toBeInTheDocument(),
    );
  });

  it('사이드카를 실행하지 못했으면 원인과 해결 방법', async () => {
    const { shell } = renderApp();
    act(() => shell.restart({ state: 'failed' }));
    const title = await screen.findByText('Vater 백그라운드 서비스를 실행하지 못했습니다');
    const banner = title.closest('[role="status"]') as HTMLElement;
    expect(within(banner).getByText(/트레이 메뉴 > 종료/)).toBeInTheDocument();
  });
});

describe('상태 표시줄', () => {
  it('시장 상태, 한투 연결, AI 엔진', async () => {
    renderApp();
    const bar = statusBar();
    expect(await within(bar).findByText('국내 장중')).toBeInTheDocument();
    expect(within(bar).getByText('15:30 마감')).toBeInTheDocument();
    expect(within(bar).getByText('미국 마감')).toBeInTheDocument();
    expect(within(bar).getByText('실시간 1 · 폴링 1')).toBeInTheDocument();
    expect(await within(bar).findByText(/클라우드 · gemini-3-pro/)).toBeInTheDocument();
  });

  it('alerts.state 이벤트로 바뀐다', async () => {
    const { stream } = renderApp();
    const source = await stream();
    await within(statusBar()).findByText('실시간 1 · 폴링 1');
    emit(source, 'alerts.state', {
      state: 'running',
      realtime: 3,
      polling: 0,
      markets: { KR: 'closed', US: 'open' },
      feeds: [],
    });
    const bar = statusBar();
    expect(await within(bar).findByText('실시간 3')).toBeInTheDocument();
    expect(within(bar).getByText('국내 마감')).toBeInTheDocument();
    expect(within(bar).getByText('미국 장중')).toBeInTheDocument();
  });

  it('한투 연결이 끊기면(offline) 끊김', async () => {
    mock.db.monitor = { ...mock.db.monitor, state: 'offline', realtime: 0, polling: 0 };
    renderApp();
    expect(await within(statusBar()).findByText('끊김 · 재연결 중')).toBeInTheDocument();
  });

  it('AI 엔진 확인이 실패하면 원인을 보여 준다', async () => {
    server.use(
      http.get('*/llm/check', () =>
        errorResponse(
          400,
          'LLM_KEY_MISSING',
          '클라우드 AI 키가 없습니다.',
          '설정에서 키를 넣으세요.',
        ),
      ),
    );
    renderApp();
    expect(await within(statusBar()).findByText(/클라우드 AI 키가 없습니다/)).toBeInTheDocument();
  });

  it('진행 중인 분석 수', async () => {
    const { stream } = renderApp();
    const source = await stream();
    emit(source, 'analysis.status', { id: 50, status: 'running' });
    expect(await within(statusBar()).findByText(/분석 1건 진행 중/)).toBeInTheDocument();
    emit(source, 'analysis.status', { id: 50, status: 'done', decision: 'Hold' });
    await waitFor(() =>
      expect(within(statusBar()).queryByText(/분석 1건 진행 중/)).not.toBeInTheDocument(),
    );
  });

  it('마지막 수신 시각', async () => {
    const { stream } = renderApp();
    const source = await stream();
    emit(source, 'alerts.state', mock.db.monitor);
    expect(
      await within(statusBar()).findByText(/^마지막 수신 \d\d:\d\d:\d\d$/),
    ).toBeInTheDocument();
  });
});

describe('사이드바 아래쪽: 감시 상태와 일시 중지', () => {
  it('일시 중지 → 재개', async () => {
    renderApp();
    const side = screen.getByRole('complementary');
    expect(await within(side).findByText('알림 감시 중')).toBeInTheDocument();
    await userEvent.click(within(side).getByRole('button', { name: '감시 일시 중지' }));
    expect(await within(side).findByText('감시 일시 중지됨')).toBeInTheDocument();
    await userEvent.click(within(side).getByRole('button', { name: '감시 재개' }));
    expect(await within(side).findByText('알림 감시 중')).toBeInTheDocument();
  });

  it('일시 중지가 실패하면 원인을 보여 준다', async () => {
    server.use(
      http.post('*/alerts/pause', () =>
        errorResponse(
          503,
          'ALERTS_UNAVAILABLE',
          '감시를 시작하지 못했습니다.',
          '앱을 다시 시작하세요.',
        ),
      ),
    );
    renderApp();
    const side = screen.getByRole('complementary');
    await within(side).findByText('알림 감시 중');
    await userEvent.click(within(side).getByRole('button', { name: '감시 일시 중지' }));
    expect(await within(side).findByText(/감시를 시작하지 못했습니다/)).toBeInTheDocument();
  });

  it('연결한 서버(실전/모의)', async () => {
    mock.db.settings['kis.server'] = 'vps';
    renderApp();
    expect(
      await within(screen.getByRole('complementary')).findByText('한투 모의 서버'),
    ).toBeInTheDocument();
  });
});

describe('새 알림 배지', () => {
  it('다른 화면에 있을 때 온 알림 수를 감시·알림 메뉴에 보이고, 그 화면에 가면 지운다', async () => {
    const { stream } = renderApp('#/home');
    const source = await stream();
    const fired = mock.db.events[0];
    if (!fired) throw new Error('fixture');
    emit(source, 'alert.fired', fired);
    emit(source, 'alert.fired', { ...fired, id: 99 });
    const link = within(sidebar()).getByRole('link', { name: /감시·알림/ });
    await waitFor(() => expect(link).toHaveAccessibleName('감시·알림, 새 알림 2건'));
    act(() => {
      window.location.hash = '#/alerts';
    });
    await waitFor(() => expect(link).toHaveAccessibleName('감시·알림'));
  });
});
