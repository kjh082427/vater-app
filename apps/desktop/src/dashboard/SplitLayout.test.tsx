import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { computeRects, GAP } from './layout/geometry';
import { PANEL_MINS } from './layout/mins';
import { templateRoot } from './layout/templates';
import type { Node, Size, Split } from './layout/types';
import { SplitLayout } from './SplitLayout';

const AREA: Size = { w: 1012, h: 600 }; // 가로로 칸에 쓰는 너비 1000
const MINS = [PANEL_MINS.watchlist, PANEL_MINS.briefing];

function Harness({
  initial,
  area = AREA,
  onChange,
}: {
  initial: Node;
  area?: Size;
  onChange?: (n: Node) => void;
}) {
  const [root, setRoot] = useState(initial);
  return (
    <SplitLayout
      root={root}
      mins={MINS}
      gap={GAP}
      area={area}
      onResize={(next) => {
        setRoot(next);
        onChange?.(next);
      }}
      renderPanel={(i) => <p>{`칸 ${i + 1}`}</p>}
    />
  );
}

const cell = (i: number) => document.querySelector<HTMLElement>(`[data-panel="${i}"]`);
const px = (v: number) => `${v}px`;

describe('SplitLayout', () => {
  it('칸을 computeRects 위치에 그린다', () => {
    const root = templateRoot('left-big-3');
    const mins = [PANEL_MINS.kpi, PANEL_MINS.kpi, PANEL_MINS.kpi];
    render(
      <SplitLayout root={root} mins={mins} gap={GAP} area={AREA} renderPanel={(i) => <p>{i}</p>} />,
    );
    computeRects(root, AREA, GAP).forEach((r, i) => {
      const el = cell(i);
      expect(el?.style.left).toBe(px(r.x));
      expect(el?.style.top).toBe(px(r.y));
      expect(el?.style.width).toBe(px(r.w));
      expect(el?.style.height).toBe(px(r.h));
    });
  });

  it('보기 전용이면 경계선이 없다', () => {
    render(
      <SplitLayout
        root={templateRoot('cols-2')}
        mins={MINS}
        gap={GAP}
        area={AREA}
        renderPanel={() => null}
      />,
    );
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('영역이 최소 합보다 작으면 스크롤하고 칸은 최소 크기를 지킨다', () => {
    const small = { w: 500, h: 150 };
    render(
      <SplitLayout
        root={templateRoot('cols-2')}
        mins={MINS}
        gap={GAP}
        area={small}
        renderPanel={() => null}
      />,
    );
    const scroller = screen.getByRole('group', { name: /스크롤/ });
    expect(scroller).toHaveAttribute('data-scroll', 'true');
    // 비율 50:50을 지키며 감시 종목 360px: 전체 360/0.5 + 12
    expect(parseFloat(cell(0)?.style.width ?? '0')).toBeGreaterThanOrEqual(360);
    expect(parseFloat(cell(1)?.style.width ?? '0')).toBeGreaterThanOrEqual(300);
    expect(parseFloat(cell(0)?.style.height ?? '0')).toBeGreaterThanOrEqual(180);
  });
});

describe('편집 캔버스(fitToArea)', () => {
  it('최소 합보다 작아도 영역에 맞춰 그린다(스크롤 없음)', () => {
    const small = { w: 500, h: 150 };
    render(
      <SplitLayout
        fitToArea
        root={templateRoot('cols-2')}
        mins={MINS}
        gap={GAP}
        area={small}
        renderPanel={() => null}
      />,
    );
    expect(screen.queryByRole('group', { name: /스크롤/ })).not.toBeInTheDocument();
    expect(cell(1)?.style.width).toBe(px(244));
  });
});

describe('경계선', () => {
  it('role="separator", 방향, aria-valuenow(왼쪽 칸 %)', () => {
    render(<Harness initial={templateRoot('cols-2')} />);
    const sep = screen.getByRole('separator', { name: '칸 1과 칸 2 사이 경계선' });
    expect(sep).toHaveAttribute('aria-orientation', 'vertical');
    expect(sep).toHaveAttribute('aria-valuenow', '50');
    expect(sep).toHaveAttribute('aria-valuetext', '50 : 50');
  });

  it('키보드 ←/→로 5%씩, 최소 크기에서 멈춘다', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={templateRoot('cols-2')} onChange={onChange} />);
    const sep = screen.getByRole('separator');
    sep.focus();
    await user.keyboard('{ArrowRight}');
    expect(sep).toHaveAttribute('aria-valuenow', '55');
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(sep).toHaveAttribute('aria-valuenow', '45');
    // 감시 종목(왼쪽) 최소 360px = 36%
    for (let i = 0; i < 5; i++) await user.keyboard('{ArrowLeft}');
    expect(sep).toHaveAttribute('aria-valuenow', '36');
    const last = onChange.mock.lastCall?.[0] as Split;
    expect(last.sizes[0]).toBeCloseTo(0.36, 6);
  });

  it('위아래 분할은 ↑/↓, 가로 방향 표시', async () => {
    const user = userEvent.setup();
    render(<Harness initial={templateRoot('rows-2')} />);
    const sep = screen.getByRole('separator');
    expect(sep).toHaveAttribute('aria-orientation', 'horizontal');
    sep.focus();
    await user.keyboard('{ArrowDown}');
    expect(sep).toHaveAttribute('aria-valuenow', '55');
  });

  it('포인터로 끌면 비율이 바뀌고, 끄는 동안 비율 표시, 최소 크기에서 멈춘다', () => {
    const onChange = vi.fn();
    render(<Harness initial={templateRoot('cols-2')} onChange={onChange} />);
    const sep = screen.getByRole('separator');
    fireEvent.pointerDown(sep, { clientX: 500, pointerId: 1, button: 0 });
    fireEvent.pointerMove(sep, { clientX: 580, pointerId: 1 });
    expect(sep).toHaveAttribute('aria-valuenow', '58');
    expect(screen.getByText('58 : 42')).toBeInTheDocument();
    fireEvent.pointerMove(sep, { clientX: 1000, pointerId: 1 });
    expect(sep).toHaveAttribute('aria-valuenow', '70'); // 브리핑(오른쪽) 최소 300px = 30%
    fireEvent.pointerUp(sep, { clientX: 1000, pointerId: 1 });
    expect(screen.queryByText('70 : 30')).not.toBeInTheDocument();
    expect((onChange.mock.lastCall?.[0] as Split).sizes[1]).toBeCloseTo(0.3, 6);
  });

  it('안쪽 분할에도 경계선이 있다(2×2면 3개)', () => {
    render(<Harness initial={templateRoot('grid-2x2')} />);
    expect(screen.getAllByRole('separator')).toHaveLength(3);
  });
});
