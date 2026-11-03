import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Sparkline } from './Sparkline';

function points(container: HTMLElement): [number, number][] {
  const raw = container.querySelector('polyline')?.getAttribute('points') ?? '';
  return raw
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(',').map(Number) as [number, number]);
}

describe('Sparkline: 선 하나 + 끝점', () => {
  it('값 범위에 맞춰 늘린다: 최댓값은 위, 최솟값은 아래, 처음과 끝은 좌우 끝', () => {
    const { container } = render(
      <Sparkline values={[10, 20, 15]} label="코스피 최근 30일 종가" width={84} height={22} />,
    );
    const p = points(container);
    expect(p).toHaveLength(3);
    const [first, max, last] = p as [[number, number], [number, number], [number, number]];
    expect(first[0]).toBeCloseTo(2.5);
    expect(last[0]).toBeCloseTo(81.5);
    expect(max[0]).toBeCloseTo(42);
    expect(max[1]).toBeCloseTo(2.5);
    expect(first[1]).toBeCloseTo(19.5);
    expect(last[1]).toBeCloseTo(11);
  });

  it('끝점에 점을 찍는다', () => {
    const { container } = render(<Sparkline values={[10, 20, 15]} label="코스피" />);
    const dot = container.querySelector('circle');
    const [, , last] = points(container);
    expect(Number(dot?.getAttribute('cx'))).toBeCloseTo(last?.[0] ?? NaN);
    expect(Number(dot?.getAttribute('cy'))).toBeCloseTo(last?.[1] ?? NaN);
  });

  it('방향을 주지 않으면 처음·끝 비교로 색을 지어내지 않는다: 먹(flat), 이름에 방향 말 없음', () => {
    // 30일 사이 하락해도 옆 숫자(전일 대비)는 상승일 수 있다. 색은 옆 숫자와 같은 자료여야 한다.
    render(<Sparkline values={[742, 750, 739]} label="코스닥 최근 30일 종가" />);
    const img = screen.getByRole('img', { name: '코스닥 최근 30일 종가' });
    expect(img).toHaveAttribute('data-direction', 'flat');
  });

  it('방향을 주면(옆 숫자와 같은 전일 대비 방향) 그 색으로 칠하고 이름에 덧붙인다', () => {
    render(<Sparkline values={[742, 739]} label="코스닥" direction="up" />);
    expect(screen.getByRole('img', { name: '코스닥, 상승' })).toHaveAttribute(
      'data-direction',
      'up',
    );
  });

  it('값이 모두 같으면 가운데 수평선', () => {
    const { container } = render(
      <Sparkline values={[5, 5, 5]} label="보합" width={84} height={22} />,
    );
    expect(points(container).map(([, y]) => y)).toEqual([11, 11, 11]);
  });

  it('숫자가 아닌 값은 건너뛴다', () => {
    const { container } = render(<Sparkline values={[1, Number.NaN, 3]} label="x" />);
    expect(points(container)).toHaveLength(2);
  });

  it('값이 하나면 점만', () => {
    const { container } = render(<Sparkline values={[5]} label="x" width={84} height={22} />);
    expect(container.querySelector('polyline')).toBeNull();
    expect(Number(container.querySelector('circle')?.getAttribute('cy'))).toBeCloseTo(11);
  });

  it('값이 없으면 그리지 않고 "데이터 없음"', () => {
    const { container } = render(<Sparkline values={[]} label="코스닥 최근 30일 종가" />);
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByText('코스닥 최근 30일 종가: 데이터 없음')).toBeInTheDocument();
  });

  it('크기는 rem으로(16px 기준)', () => {
    render(<Sparkline values={[1, 2]} label="x" width={88} height={24} />);
    const svg = screen.getByRole('img');
    expect(svg.getAttribute('viewBox')).toBe('0 0 88 24');
    expect(svg.style.width).toBe('5.5rem');
    expect(svg.style.height).toBe('1.5rem');
  });
});
