import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithServices } from '../test/render';
import { DashboardEditor } from './DashboardEditor';
import { templateRoot } from './layout/templates';
import type { DashboardDoc } from './layout/types';

function windowSize(w: number, h: number) {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
}
afterEach(() => {
  windowSize(1024, 768);
  delete (document as { elementFromPoint?: unknown }).elementFromPoint;
});

/** 2×2 격자: 칸 1 감시 종목(시장 국내), 칸 4 알림 이력(종목·종류 옵션). */
const grid: DashboardDoc = {
  id: 'b',
  name: '기본',
  kpi: { enabled: true, items: ['kospi', 'kosdaq', 'watch-count'] },
  layout: { template: 'grid-2x2', root: templateRoot('grid-2x2') },
  panels: [
    { type: 'watchlist', options: { market: 'KR' } },
    { type: 'briefing', options: { market: 'US' } },
    { type: 'recent-alerts', options: {} },
    { type: 'alert-history', options: { kind: 'all', symbol: 'all' } },
  ],
};

/** 왼쪽 크게 + 오른쪽 2: 작은 창에서 오른쪽 칸(약 312×238)에는 분석 결과(최소 360×240)가 들어가지 않는다. */
const tight: DashboardDoc = {
  ...grid,
  kpi: { enabled: false, items: [] },
  layout: { template: 'left-big-3', root: templateRoot('left-big-3') },
  panels: [
    { type: 'analysis-result', options: { analysis: 'latest' } },
    { type: 'recent-alerts', options: {} },
    { type: 'running-analyses', options: {} },
  ],
};

function open(board: DashboardDoc) {
  const saved: DashboardDoc[] = [];
  const onCancel = vi.fn();
  renderWithServices(
    <DashboardEditor
      board={board}
      onCancel={onCancel}
      onSave={async (b) => {
        saved.push(b);
      }}
    />,
  );
  return { saved, onCancel };
}

const cell = (n: number) => screen.getByRole('group', { name: new RegExp(`^칸 ${n}:`) });
const handle = (n: number) => screen.getByRole('button', { name: `칸 ${n} 위치 바꾸기` });

/** jsdom에는 elementFromPoint가 없다: 끌어서 닿은 칸을 흉내 낸다. */
function pointAt(target: HTMLElement | null) {
  (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () =>
    target;
}

/** 칸 from을 잡고 칸 to 위로 끌어 놓는다. */
function drag(from: HTMLElement, to: HTMLElement, opts: { grabAt?: HTMLElement } = {}) {
  const start = opts.grabAt ?? from;
  fireEvent.pointerDown(start, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
  pointAt(to);
  fireEvent.pointerMove(from, { pointerId: 1, buttons: 1, clientX: 200, clientY: 120 });
  fireEvent.pointerUp(from, { pointerId: 1, clientX: 200, clientY: 120 });
}

async function save() {
  await userEvent.click(screen.getByRole('button', { name: '저장' }));
}

describe('끌어서 칸 바꾸기(스펙 18장)', () => {
  it('칸 1을 칸 4에 놓으면 내용과 옵션이 함께 맞바뀌고, 틀과 비율은 그대로다', async () => {
    windowSize(1280, 800);
    const { saved } = open(grid);
    drag(cell(1), cell(4));
    expect(within(cell(1)).getByText('알림 이력')).toBeInTheDocument();
    expect(within(cell(4)).getByText('감시 종목')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('칸 1 ↔ 칸 4 내용을 바꿨습니다');
    await save();
    await waitFor(() => expect(saved).toHaveLength(1));
    const doc = saved[0] as DashboardDoc;
    expect(doc.panels[0]).toEqual({
      type: 'alert-history',
      options: { kind: 'all', symbol: 'all' },
    });
    expect(doc.panels[3]).toEqual({ type: 'watchlist', options: { market: 'KR' } });
    expect(doc.panels[1]).toEqual(grid.panels[1]);
    expect(doc.layout).toEqual(grid.layout);
    expect(doc.kpi).toEqual(grid.kpi);
  });

  it('제자리에 놓거나 칸 밖에 놓으면 바뀌지 않는다', async () => {
    windowSize(1280, 800);
    const { saved } = open(grid);
    drag(cell(1), cell(1));
    drag(cell(2), document.body);
    pointAt(null);
    fireEvent.pointerDown(cell(3), { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(cell(3), { pointerId: 1, clientX: 5, clientY: 5 });
    await save();
    await waitFor(() => expect(saved).toHaveLength(1));
    expect((saved[0] as DashboardDoc).panels).toEqual(grid.panels);
  });

  it('옮겨 간 내용이 그 칸의 최소 크기보다 크면 놓을 수 없고 이유를 보인다', async () => {
    windowSize(1024, 600);
    const { saved } = open(tight);
    drag(cell(1), cell(2));
    const reason = screen.getByRole('status');
    expect(reason).toHaveTextContent(/칸 1 ↔ 칸 2/);
    expect(reason).toHaveTextContent(/칸이 작아 들어가지 않음/);
    expect(reason).toHaveTextContent(/최소 360×240px/);
    expect(within(cell(1)).getByText('분석 결과')).toBeInTheDocument();
    await save();
    await waitFor(() => expect(saved).toHaveLength(1));
    expect((saved[0] as DashboardDoc).panels).toEqual(tight.panels);
  });

  it('끄는 동안 닿은 칸이 맞지 않으면 표시한다', async () => {
    windowSize(1024, 600);
    open(tight);
    fireEvent.pointerDown(cell(1), { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    pointAt(cell(2));
    fireEvent.pointerMove(cell(1), { pointerId: 1, buttons: 1, clientX: 300, clientY: 100 });
    expect(cell(2)).toHaveAttribute('data-reorder-state', 'blocked');
    pointAt(cell(3));
    fireEvent.pointerMove(cell(1), { pointerId: 1, buttons: 1, clientX: 300, clientY: 300 });
    expect(cell(3)).toHaveAttribute('data-reorder-state', 'blocked');
    fireEvent.pointerUp(cell(1), { pointerId: 1 });
  });

  it('입력칸과 버튼을 눌러서는 끌기가 시작되지 않는다', async () => {
    windowSize(1280, 800);
    const { saved } = open(grid);
    const button = within(cell(1)).getByRole('button', { name: /내용 바꾸기/ });
    drag(cell(1), cell(4), { grabAt: button });
    const select = within(cell(1)).getByRole('button', { name: /^시장 / });
    drag(cell(1), cell(4), { grabAt: select });
    expect(cell(1)).not.toHaveAttribute('data-reorder-state', 'from');
    // 칸 안 아무 곳이나 눌러도(글자 영역) 끌린다는 것은 위 테스트가 보인다. 여기서는 바뀌지 않았다.
    expect(within(cell(1)).getByText('감시 종목')).toBeInTheDocument();
    await save();
    await waitFor(() => expect(saved).toHaveLength(1));
    expect((saved[0] as DashboardDoc).panels).toEqual(grid.panels);
  });

  it('키보드: 손잡이에서 Space로 잡고 방향키로 칸을 고르고 Space로 놓는다', async () => {
    windowSize(1280, 800);
    const { saved } = open(grid);
    handle(1).focus();
    await userEvent.keyboard(' ');
    expect(screen.getByRole('status')).toHaveTextContent('칸 1: 잡았습니다');
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(screen.getByRole('status')).toHaveTextContent('바꿀 칸: 칸 4');
    expect(cell(4)).toHaveAttribute('data-reorder-state', 'over');
    await userEvent.keyboard(' ');
    expect(within(cell(1)).getByText('알림 이력')).toBeInTheDocument();
    expect(within(cell(4)).getByText('감시 종목')).toBeInTheDocument();
    await save();
    await waitFor(() => expect(saved).toHaveLength(1));
    expect((saved[0] as DashboardDoc).panels[3]).toEqual({
      type: 'watchlist',
      options: { market: 'KR' },
    });
  });

  it('키보드로도 맞지 않으면 놓지 않고 이유를 알린다', async () => {
    windowSize(1024, 600);
    open(tight);
    handle(1).focus();
    await userEvent.keyboard(' {ArrowRight} ');
    expect(screen.getByRole('status')).toHaveTextContent(/칸이 작아 들어가지 않음/);
    expect(within(cell(1)).getByText('분석 결과')).toBeInTheDocument();
  });

  it('Esc는 잡은 것만 놓고 편집 화면은 닫지 않는다', async () => {
    windowSize(1280, 800);
    const { onCancel } = open(grid);
    handle(1).focus();
    await userEvent.keyboard(' {ArrowRight}');
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('status')).toHaveTextContent('취소했습니다');
    expect(cell(2)).not.toHaveAttribute('data-reorder-state');
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe('끌어서 숫자 줄 순서 바꾸기', () => {
  const order = () =>
    within(screen.getByRole('list', { name: '숫자 줄 순서' }))
      .getAllByRole('listitem')
      .map((li) => li.textContent?.replace('순서 바꾸기', '').trim());

  it('숫자를 끌어 다른 숫자 자리에 놓으면 순서가 바뀌고 저장된다', async () => {
    windowSize(1280, 800);
    const { saved } = open(grid);
    expect(order()).toEqual(['코스피', '코스닥', '감시 종목']);
    const items = within(screen.getByRole('list', { name: '숫자 줄 순서' })).getAllByRole(
      'listitem',
    );
    drag(items[2] as HTMLElement, items[0] as HTMLElement);
    expect(order()).toEqual(['감시 종목', '코스피', '코스닥']);
    await save();
    await waitFor(() => expect(saved).toHaveLength(1));
    expect((saved[0] as DashboardDoc).kpi.items).toEqual(['watch-count', 'kospi', 'kosdaq']);
  });

  it('키보드로 같은 일을 한다', async () => {
    windowSize(1280, 800);
    const { saved } = open(grid);
    screen.getByRole('button', { name: '감시 종목 순서 바꾸기' }).focus();
    await userEvent.keyboard(' {ArrowLeft}{ArrowLeft} ');
    expect(order()).toEqual(['감시 종목', '코스피', '코스닥']);
    await save();
    await waitFor(() => expect(saved).toHaveLength(1));
    expect((saved[0] as DashboardDoc).kpi.items).toEqual(['watch-count', 'kospi', 'kosdaq']);
  });

  it('숫자가 하나뿐이면 순서 목록은 없다', () => {
    windowSize(1280, 800);
    open({ ...grid, kpi: { enabled: true, items: ['kospi'] } });
    expect(screen.queryByRole('list', { name: '숫자 줄 순서' })).not.toBeInTheDocument();
  });
});

describe('리뷰 지적: 끌기 중 Esc·버튼 뗌·빈 곳·문구', () => {
  it('끄는 중 Esc는 끌기만 취소하고 편집 화면 취소로 올라가지 않는다', async () => {
    windowSize(1280, 800);
    const { onCancel, saved } = open(grid);
    handle(1).focus();
    fireEvent.pointerDown(handle(1), { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    pointAt(cell(4));
    fireEvent.pointerMove(cell(1), { pointerId: 1, buttons: 1, clientX: 200, clientY: 120 });
    expect(cell(1)).toHaveAttribute('data-reorder-state', 'from');
    await userEvent.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
    expect(cell(1)).not.toHaveAttribute('data-reorder-state', 'from');
    expect(screen.getByRole('status')).toHaveTextContent('취소했습니다');
    // 이어서 버튼을 놓아도 바뀌지 않는다
    fireEvent.pointerUp(cell(1), { pointerId: 1, clientX: 200, clientY: 120 });
    await save();
    await waitFor(() => expect(saved).toHaveLength(1));
    expect((saved[0] as DashboardDoc).panels).toEqual(grid.panels);
  });

  it('끄는 중 버튼이 이미 떼어져 있으면(buttons가 0) 끌기를 끝낸다', () => {
    windowSize(1280, 800);
    open(grid);
    fireEvent.pointerDown(cell(1), { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    pointAt(cell(4));
    fireEvent.pointerMove(cell(1), { pointerId: 1, buttons: 1, clientX: 200, clientY: 120 });
    expect(cell(4)).toHaveAttribute('data-reorder-state', 'over');
    fireEvent.pointerMove(cell(1), { pointerId: 1, buttons: 0, clientX: 210, clientY: 130 });
    expect(cell(4)).not.toHaveAttribute('data-reorder-state');
    expect(cell(1)).not.toHaveAttribute('data-reorder-state', 'from');
  });

  it('빈 곳에 놓으면 상태 문구를 지운다', () => {
    windowSize(1280, 800);
    open(grid);
    fireEvent.pointerDown(cell(1), { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    pointAt(cell(4));
    fireEvent.pointerMove(cell(1), { pointerId: 1, buttons: 1, clientX: 200, clientY: 120 });
    expect(screen.getByRole('status')).toHaveTextContent('바꿀 칸: 칸 4');
    pointAt(null);
    fireEvent.pointerUp(cell(1), { pointerId: 1, clientX: 900, clientY: 900 });
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('숫자 줄은 끼워 넣기라서 "A를 C 자리로 옮겼습니다"로 알린다', () => {
    windowSize(1280, 800);
    open(grid);
    const items = within(screen.getByRole('list', { name: '숫자 줄 순서' })).getAllByRole(
      'listitem',
    );
    drag(items[2] as HTMLElement, items[0] as HTMLElement);
    expect(screen.getByRole('status')).toHaveTextContent('감시 종목을 코스피 자리로 옮겼습니다.');
  });

  it('칸은 끌 때만 터치 스크롤·글자 선택을 막고 입력칸은 막지 않는다', () => {
    const css = readFileSync('src/dashboard/editor/editor.module.css', 'utf8');
    const rule = (sel: string) => css.match(new RegExp(`${sel}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    expect(rule('\\.cell')).toMatch(/touch-action:\s*none/);
    expect(rule('\\.cell')).toMatch(/user-select:\s*none/);
    expect(css).toMatch(
      /\.cell\s+(input|:where\([^)]*input[^)]*\))[^{]*\{[^}]*user-select:\s*text/,
    );
  });
});
