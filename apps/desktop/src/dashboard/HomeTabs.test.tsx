import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { errorResponse } from '../mocks/handlers';
import { renderWithServices } from '../test/render';
import { mock, server } from '../test/server';
import { defaultDashboard } from './layout/defaults';
import type { DashboardsDoc } from './layout/types';
import { HomeTabs } from './HomeTabs';
import { useDashboards } from './store';

/** 탭 본문 자리: 이 테스트는 탭만 본다. */
function Harness({ tab }: { tab?: string }) {
  const store = useDashboards();
  return <HomeTabs store={store} tab={tab} renderBoard={(b) => <p>{`본문 ${b.name}`}</p>} />;
}

function docOf(...names: string[]): DashboardsDoc {
  return {
    version: 1,
    dashboards: names.map((name, i) => defaultDashboard(`d${i}`, name)),
  };
}

/** PUT /ui/dashboards 본문 기록. */
function recordPuts() {
  const bodies: DashboardsDoc[] = [];
  server.events.on('request:start', ({ request }) => {
    if (request.method === 'PUT' && request.url.endsWith('/ui/dashboards')) {
      void request
        .clone()
        .json()
        .then((b) => bodies.push(b as DashboardsDoc));
    }
  });
  return bodies;
}

const tabNames = () => screen.getAllByRole('tab').map((t) => t.textContent);

async function openTabMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /화면 메뉴/ }));
  return screen.getByRole('menu');
}

describe('홈 탭: 문서 읽기', () => {
  it('처음(빈 문서)이면 "기본" 탭 1장', async () => {
    renderWithServices(<Harness />);
    expect(await screen.findByRole('tab', { name: '기본', selected: true })).toBeInTheDocument();
    expect(screen.getByText('본문 기본')).toBeInTheDocument();
    expect(screen.queryByText(/기본 배치로 열었습니다/)).not.toBeInTheDocument();
  });

  it('깨진 문서면 기본 탭과 정보 배너', async () => {
    mock.db.dashboards = { version: 1, dashboards: [{ id: 'x', name: 3 }] };
    renderWithServices(<Harness />);
    expect(await screen.findByRole('tab', { name: '기본' })).toBeInTheDocument();
    expect(
      screen.getByText('저장된 화면 배치를 읽지 못해 기본 배치로 열었습니다.'),
    ).toBeInTheDocument();
  });

  it('일부 장만 깨졌으면 남은 장과 정보 배너, 콘솔에는 문제 목록만', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mock.db.dashboards = {
      version: 1,
      dashboards: [defaultDashboard('d0', '국내'), { id: 'x', name: 3 }],
    };
    renderWithServices(<Harness />);
    expect(await screen.findByRole('tab', { name: '국내' })).toBeInTheDocument();
    expect(screen.getByText('일부 화면을 읽지 못했습니다')).toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith('대시보드 문서 확인', ['2번째 화면: 이름이 올바르지 않음']);
  });

  it('모르는 내용 종류뿐이면 배너 없이 그 칸이 안내한다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const board = defaultDashboard('d0', '국내');
    board.panels[0] = { type: 'heatmap', options: {} };
    mock.db.dashboards = { version: 1, dashboards: [board] };
    renderWithServices(<Harness />);
    expect(await screen.findByRole('tab', { name: '국내' })).toBeInTheDocument();
    expect(screen.queryByText('일부 화면을 읽지 못했습니다')).not.toBeInTheDocument();
  });

  it('불러오기 실패면 사이드카 문구 그대로와 [다시 시도]', async () => {
    server.use(
      http.get('*/ui/dashboards', () =>
        errorResponse(
          500,
          'INTERNAL',
          '예상하지 못한 오류가 발생했습니다.',
          '로그 폴더를 확인해 주세요.',
        ),
      ),
    );
    renderWithServices(<Harness />);
    expect(await screen.findByText(/로그 폴더를 확인해 주세요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument();
  });

  it('#/home?tab=<id>로 탭을 고르고, 없는 id면 첫 탭', async () => {
    mock.db.dashboards = docOf('국내', '미국');
    const { unmount } = renderWithServices(<Harness tab="d1" />);
    expect(await screen.findByRole('tab', { name: '미국', selected: true })).toBeInTheDocument();
    unmount();
    renderWithServices(<Harness tab="nope" />);
    expect(await screen.findByRole('tab', { name: '국내', selected: true })).toBeInTheDocument();
  });

  it('탭을 누르면 주소가 #/home?tab=<id>', async () => {
    const user = userEvent.setup();
    mock.db.dashboards = docOf('국내', '미국');
    renderWithServices(<Harness />);
    await user.click(await screen.findByRole('tab', { name: '미국' }));
    await waitFor(() => expect(window.location.hash).toBe('#/home?tab=d1'));
  });
});

describe('홈 탭: 조작마다 PUT 1번', () => {
  it('탭 추가: 이름 "새 화면 1", 그 탭으로 이동', async () => {
    const user = userEvent.setup();
    const puts = recordPuts();
    renderWithServices(<Harness />);
    await user.click(await screen.findByRole('button', { name: '화면 추가' }));
    expect(await screen.findByRole('tab', { name: '새 화면 1' })).toBeInTheDocument();
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]?.dashboards.map((d) => d.name)).toEqual(['기본', '새 화면 1']);
    const added = puts[0]?.dashboards[1]?.id ?? '';
    await waitFor(() => expect(window.location.hash).toBe(`#/home?tab=${added}`));
  });

  it('8장이면 추가 버튼이 막히고 이유가 보인다', async () => {
    mock.db.dashboards = docOf(...Array.from({ length: 8 }, (_, i) => `화면${i + 1}`));
    renderWithServices(<Harness />);
    const add = await screen.findByRole('button', { name: '화면 추가' });
    expect(add).toBeDisabled();
    expect(add).toHaveAccessibleDescription('화면은 8장까지 만들 수 있습니다');
  });

  it('이름 바꾸기: 빈 이름과 21자는 거절, 20자는 저장', async () => {
    const user = userEvent.setup();
    const puts = recordPuts();
    renderWithServices(<Harness />);
    await user.click(
      within(await openTabMenu(user)).getByRole('menuitem', { name: '이름 바꾸기' }),
    );
    const dialog = screen.getByRole('dialog', { name: '화면 이름 바꾸기' });
    const input = within(dialog).getByRole('textbox', { name: '이름' });
    await user.clear(input);
    await user.click(within(dialog).getByRole('button', { name: '저장' }));
    expect(within(dialog).getByText('이름을 입력하세요.')).toBeInTheDocument();
    await user.type(input, '가'.repeat(21));
    await user.click(within(dialog).getByRole('button', { name: '저장' }));
    expect(within(dialog).getByText('이름은 20자까지 쓸 수 있습니다.')).toBeInTheDocument();
    expect(puts).toHaveLength(0);
    await user.clear(input);
    await user.type(input, '가'.repeat(20));
    await user.click(within(dialog).getByRole('button', { name: '저장' }));
    expect(await screen.findByRole('tab', { name: '가'.repeat(20) })).toBeInTheDocument();
    await waitFor(() => expect(puts).toHaveLength(1));
  });

  it('삭제: 마지막 1장은 막혀 있고, 2장이면 확인 뒤 지운다', async () => {
    const user = userEvent.setup();
    const puts = recordPuts();
    const { unmount } = renderWithServices(<Harness />);
    const only = within(await openTabMenu(user)).getByRole('menuitem', { name: /화면 지우기/ });
    expect(only).toHaveAttribute('aria-disabled', 'true');
    expect(only).toHaveAccessibleDescription('마지막 화면은 지울 수 없습니다');
    unmount();

    mock.db.dashboards = docOf('국내', '미국');
    renderWithServices(<Harness tab="d1" />);
    await user.click(
      within(await openTabMenu(user)).getByRole('menuitem', { name: /화면 지우기/ }),
    );
    const dialog = screen.getByRole('dialog', { name: '‘미국’ 화면을 지울까요?' });
    await user.click(within(dialog).getByRole('button', { name: '지우기' }));
    await waitFor(() => expect(tabNames()).toEqual(['국내']));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(screen.getByRole('tab', { name: '국내', selected: true })).toBeInTheDocument();
  });

  it('삭제 확인에서 [취소]면 그대로', async () => {
    const user = userEvent.setup();
    const puts = recordPuts();
    mock.db.dashboards = docOf('국내', '미국');
    renderWithServices(<Harness />);
    await user.click(
      within(await openTabMenu(user)).getByRole('menuitem', { name: /화면 지우기/ }),
    );
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '취소' }));
    expect(tabNames()).toEqual(['국내', '미국']);
    expect(puts).toHaveLength(0);
  });

  it('왼쪽·오른쪽으로 옮기기(끝에서는 막힘)', async () => {
    const user = userEvent.setup();
    const puts = recordPuts();
    mock.db.dashboards = docOf('국내', '미국');
    renderWithServices(<Harness tab="d1" />);
    let menu = await openTabMenu(user);
    expect(within(menu).getByRole('menuitem', { name: /오른쪽으로 옮기기/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await user.click(within(menu).getByRole('menuitem', { name: /왼쪽으로 옮기기/ }));
    await waitFor(() => expect(tabNames()).toEqual(['미국', '국내']));
    await waitFor(() => expect(puts).toHaveLength(1));
    menu = await openTabMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: /오른쪽으로 옮기기/ }));
    await waitFor(() => expect(tabNames()).toEqual(['국내', '미국']));
    await waitFor(() => expect(puts).toHaveLength(2));
  });

  it('빠르게 두 번 옮기면 늦게 온 첫 응답이 화면을 되돌리지 않는다', async () => {
    const user = userEvent.setup();
    let n = 0;
    server.use(
      http.put('*/ui/dashboards', async ({ request }) => {
        const body = (await request.json()) as object;
        n += 1;
        // 첫 저장의 응답이 두 번째보다 늦게 온다
        if (n === 1) await new Promise((r) => setTimeout(r, 300));
        return HttpResponse.json(body);
      }),
    );
    mock.db.dashboards = docOf('가', '나', '다');
    renderWithServices(<Harness tab="d0" />);
    await user.click(
      within(await openTabMenu(user)).getByRole('menuitem', { name: /오른쪽으로 옮기기/ }),
    );
    await waitFor(() => expect(tabNames()).toEqual(['나', '가', '다']));
    await user.click(
      within(await openTabMenu(user)).getByRole('menuitem', { name: /오른쪽으로 옮기기/ }),
    );
    await waitFor(() => expect(tabNames()).toEqual(['나', '다', '가']));
    await waitFor(() => expect(n).toBe(2));
    await new Promise((r) => setTimeout(r, 400));
    expect(tabNames()).toEqual(['나', '다', '가']);
  });

  it('저장 실패면 이전 상태로 돌리고 사이드카 문구를 보인다', async () => {
    const user = userEvent.setup();
    server.use(
      http.put('*/ui/dashboards', () =>
        errorResponse(
          422,
          'DASHBOARD_INVALID',
          '화면 배치를 저장하지 못했습니다.',
          '다시 시도하세요.',
        ),
      ),
    );
    renderWithServices(<Harness />);
    await user.click(await screen.findByRole('button', { name: '화면 추가' }));
    expect(await screen.findByText(/다시 시도하세요/)).toBeInTheDocument();
    await waitFor(() => expect(tabNames()).toEqual(['기본']));
  });
});
