import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { errorResponse } from '../mocks/handlers';
import { renderWithServices } from '../test/render';
import { mock, server } from '../test/server';
import { HomeScreen } from './HomeScreen';
import type { DashboardsDoc } from './layout/types';

function windowSize(w: number, h: number) {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
}

afterEach(() => windowSize(1024, 768));

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

type User = ReturnType<typeof userEvent.setup>;

async function openEditor(user: User) {
  renderWithServices(<HomeScreen />);
  await user.click(await screen.findByRole('button', { name: '배치 편집' }));
  return screen.findByRole('region', { name: '배치 편집' });
}

const countGroup = () => screen.getByRole('radiogroup', { name: '칸 수' });
const templateRadio = (name: RegExp | string) => screen.getByRole('radio', { name });
const cell = (n: number) => screen.getByRole('group', { name: new RegExp(`^칸 ${n}:`) });

async function chooseContent(user: User, n: number, label: string) {
  await user.click(within(cell(n)).getByRole('button', { name: /내용 바꾸기/ }));
  const dialog = await screen.findByRole('dialog', { name: `칸 ${n}에 보여 줄 내용` });
  await user.click(within(dialog).getByRole('button', { name: new RegExp(`^${label}`) }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

describe('배치 편집: 성공 기준 1 흐름', () => {
  it(
    '[배치 편집] → 3칸 → 왼쪽 크게 → 칸마다 내용 → [저장] → 보기',
    { timeout: 20_000 },
    async () => {
      windowSize(1280, 800);
      const user = userEvent.setup();
      const puts = recordPuts();
      const editor = await openEditor(user);
      expect(within(editor).getByText(/배치 편집 · 기본/)).toBeInTheDocument();

      await user.click(within(countGroup()).getByRole('radio', { name: '3' }));
      await user.click(templateRadio(/왼쪽 크게 \+ 오른쪽 2/));
      expect(templateRadio(/왼쪽 크게 \+ 오른쪽 2/)).toBeChecked();
      await chooseContent(user, 1, '감시 종목');
      await chooseContent(user, 2, '지수 차트');
      await chooseContent(user, 3, '최근 알림');
      await user.click(within(editor).getByRole('button', { name: '저장' }));

      await waitFor(() => expect(puts).toHaveLength(1));
      const board = puts[0]?.dashboards[0];
      expect(board?.layout.template).toBe('left-big-3');
      expect(board?.panels.map((p) => p.type)).toEqual([
        'watchlist',
        'index-chart',
        'recent-alerts',
      ]);
      expect(await screen.findByRole('region', { name: '칸 1: 감시 종목' })).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: '배치 편집' })).not.toBeInTheDocument();
    },
  );
});

describe('배치 편집: 규칙', () => {
  it('칸 수를 4→2로 줄이면 앞 두 칸 내용이 남는다', async () => {
    const user = userEvent.setup();
    await openEditor(user);
    await user.click(within(countGroup()).getByRole('radio', { name: '2' }));
    expect(within(cell(1)).getByText('지수 차트')).toBeInTheDocument();
    expect(within(cell(2)).getByText('브리핑 요약')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /^칸 3:/ })).not.toBeInTheDocument();
  });

  it('빈칸이 있으면 [저장]이 막히고 이유가 보인다', async () => {
    const user = userEvent.setup();
    const editor = await openEditor(user);
    await user.click(within(countGroup()).getByRole('radio', { name: '5' }));
    const save = within(editor).getByRole('button', { name: '저장' });
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription('빈칸 1개에 내용을 고르세요');
    expect(within(cell(5)).getByText('내용 고르기')).toBeInTheDocument();
  });

  it('창이 작으면 막힌 틀은 고를 수 없고 이유가 보인다(1024×600)', async () => {
    windowSize(1024, 600);
    const user = userEvent.setup();
    await openEditor(user);
    const cols4 = templateRadio(/가로 4열/);
    expect(cols4).toBeDisabled();
    expect(cols4).toHaveAccessibleDescription(
      /창이 작아 들어가지 않음: 칸 너비 약 189px < 지수 차트 최소 300px/,
    );
    expect(templateRadio(/2×2 격자/)).toBeChecked();
  });

  it('칸이 작아 들어가지 않는 내용은 막히고 이유, 시뮬레이션은 "곧 추가"', async () => {
    windowSize(1024, 600);
    const user = userEvent.setup();
    await openEditor(user);
    await user.click(within(cell(2)).getByRole('button', { name: /내용 바꾸기/ }));
    const dialog = await screen.findByRole('dialog', { name: '칸 2에 보여 줄 내용' });
    const result = within(dialog).getByRole('button', { name: /^분석 결과/ });
    expect(result).toHaveAttribute('aria-disabled', 'true');
    expect(result).toHaveAccessibleDescription(/칸이 작아 들어가지 않음/);
    const sim = within(dialog).getByRole('button', { name: /^시뮬레이션/ });
    expect(sim).toHaveAttribute('aria-disabled', 'true');
    expect(sim).toHaveAccessibleDescription('곧 추가');
    await user.click(result);
    expect(within(dialog).getByRole('button', { name: /^브리핑 요약/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('[취소]: 바꾼 것이 없으면 바로 닫히고, 있으면 확인한다', async () => {
    const user = userEvent.setup();
    const editor = await openEditor(user);
    await user.click(within(editor).getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('region', { name: '배치 편집' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '배치 편집' }));
    await user.click(within(countGroup()).getByRole('radio', { name: '2' }));
    await user.keyboard('{Escape}');
    const confirm = await screen.findByRole('dialog', { name: '바꾼 내용을 버릴까요?' });
    await user.click(within(confirm).getByRole('button', { name: '계속 편집' }));
    expect(screen.getByRole('region', { name: '배치 편집' })).toBeInTheDocument();
    expect(within(countGroup()).getByRole('radio', { name: '2' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: '취소' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: '바꾼 내용을 버릴까요?' })).getByRole(
        'button',
        { name: '버리기' },
      ),
    );
    expect(screen.queryByRole('region', { name: '배치 편집' })).not.toBeInTheDocument();
    expect(await screen.findByRole('region', { name: '칸 4: 최근 알림' })).toBeInTheDocument();
  });

  it('저장 422: 편집 화면을 유지하고 바꾼 것을 그대로 두고 사이드카 문구를 보인다', async () => {
    const user = userEvent.setup();
    server.use(
      http.put('*/ui/dashboards', () =>
        errorResponse(
          422,
          'DASHBOARD_INVALID',
          '화면 배치를 저장하지 못했습니다: 칸이 너무 많습니다',
          '칸 수를 줄이세요.',
        ),
      ),
    );
    const editor = await openEditor(user);
    await user.click(within(countGroup()).getByRole('radio', { name: '2' }));
    await user.click(within(editor).getByRole('button', { name: '저장' }));
    expect(await within(editor).findByText(/칸 수를 줄이세요/)).toBeInTheDocument();
    expect(within(countGroup()).getByRole('radio', { name: '2' })).toBeChecked();
  });

  it('저장 중 연결이 끊겨도 편집을 유지한다', async () => {
    const user = userEvent.setup();
    server.use(http.put('*/ui/dashboards', () => HttpResponse.error()));
    const editor = await openEditor(user);
    await user.click(within(countGroup()).getByRole('radio', { name: '3' }));
    await user.click(within(editor).getByRole('button', { name: '저장' }));
    expect(await within(editor).findByText('화면 배치를 저장하지 못했습니다')).toBeInTheDocument();
    expect(within(countGroup()).getByRole('radio', { name: '3' })).toBeChecked();
  });

  it('기본 배치로 되돌리기', async () => {
    const user = userEvent.setup();
    await openEditor(user);
    await user.click(within(countGroup()).getByRole('radio', { name: '1' }));
    await user.click(screen.getByRole('button', { name: '기본 배치로 되돌리기' }));
    expect(within(countGroup()).getByRole('radio', { name: '4' })).toBeChecked();
    expect(templateRadio(/2×2 격자/)).toBeChecked();
    expect(within(cell(4)).getByText('최근 알림')).toBeInTheDocument();
  });

  it('맨 위 숫자 줄: 끄기, 숫자는 5개까지', async () => {
    const user = userEvent.setup();
    const puts = recordPuts();
    const editor = await openEditor(user);
    const strip = screen.getByRole('group', { name: '맨 위 숫자 줄에 보일 숫자' });
    const spx = within(strip).getByRole('checkbox', { name: 'S&P 500' });
    expect(spx).toBeDisabled();
    expect(spx).toHaveAccessibleDescription('숫자는 5개까지 고를 수 있습니다');
    await user.click(within(strip).getByRole('checkbox', { name: '코스닥' }));
    await user.click(spx);
    await user.click(screen.getByRole('switch', { name: '숫자 카드 줄 보이기' }));
    await user.click(within(editor).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]?.dashboards[0]?.kpi).toEqual({
      enabled: false,
      items: ['kospi', 'watch-count', 'alerts-today', 'analyses-running', 'spx'],
    });
  });

  it('칸 내용의 옵션을 고른다(지수 차트 → 나스닥)', async () => {
    const user = userEvent.setup();
    const puts = recordPuts();
    const editor = await openEditor(user);
    await user.click(within(cell(1)).getByRole('button', { name: /지수/ }));
    await user.click(screen.getByRole('option', { name: '나스닥' }));
    await user.click(within(editor).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]?.dashboards[0]?.panels[0]).toEqual({
      type: 'index-chart',
      options: { index: 'COMP' },
    });
  });

  it('보기 칸의 ⋯ [내용 바꾸기]는 편집을 그 칸의 내용 고르기로 연다', async () => {
    const user = userEvent.setup();
    renderWithServices(<HomeScreen />);
    const region = await screen.findByRole('region', { name: '칸 3: 감시 종목' });
    await user.click(within(region).getByRole('button', { name: '칸 3 메뉴' }));
    await user.click(screen.getByRole('menuitem', { name: '내용 바꾸기' }));
    expect(await screen.findByRole('dialog', { name: '칸 3에 보여 줄 내용' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '배치 편집' })).toBeInTheDocument();
  });
});

describe('배치 편집: 키보드만으로', () => {
  async function tabTo(user: User, name: RegExp) {
    for (let i = 0; i < 80; i++) {
      const el = document.activeElement as HTMLElement | null;
      const label = el?.getAttribute('aria-label') ?? el?.textContent ?? '';
      if (el && name.test(label)) return el;
      await user.tab();
    }
    throw new Error(`Tab으로 ${name} 에 닿지 못함`);
  }

  it('칸 수 → 틀 → 내용 → 경계선 → 저장', { timeout: 20_000 }, async () => {
    windowSize(1280, 800);
    const user = userEvent.setup();
    const puts = recordPuts();
    mock.db.dashboards = { version: 1, dashboards: [] };
    renderWithServices(<HomeScreen />);
    await screen.findByRole('button', { name: '배치 편집' });
    await tabTo(user, /^배치 편집$/);
    await user.keyboard('{Enter}');
    await screen.findByRole('region', { name: '배치 편집' });

    // 칸 수: 라디오 묶음 안에서 화살표
    await tabTo(user, /^4$/);
    await user.keyboard('{ArrowLeft}');
    expect(within(countGroup()).getByRole('radio', { name: '3' })).toBeChecked();
    // 틀: 첫 맞는 틀이 골라져 있다. 화살표로 다음 틀
    await tabTo(user, /틀/);
    // 내용: 칸 3의 [내용 바꾸기] → 대화 상자에서 Tab·Enter
    await tabTo(user, /칸 3 내용 바꾸기/);
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: '칸 3에 보여 줄 내용' });
    await tabTo(user, /^최근 알림/);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    // 경계선: 초점을 두고 → 5%
    const sep = await tabTo(user, /사이 경계선/);
    const before = Number(sep.getAttribute('aria-valuenow'));
    await user.keyboard('{ArrowRight}');
    expect(Number(sep.getAttribute('aria-valuenow'))).toBe(before + 5);
    await tabTo(user, /^저장$/);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]?.dashboards[0]?.panels[2]?.type).toBe('recent-alerts');
  });
});
