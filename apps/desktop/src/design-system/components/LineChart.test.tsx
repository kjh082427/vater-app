import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatNumber } from '../format/money';
import { LineChart, niceTicks } from './LineChart';

const fmt = (n: number) => formatNumber(n, 2);

function linePath(container: HTMLElement): string {
  return container.querySelector('[data-role="line"]')?.getAttribute('d') ?? '';
}

describe('LineChart: 선 + 영역 차트', () => {
  it('값이 0개면 "자료 없음"을 보이고 선을 그리지 않는다', () => {
    const { container } = render(
      <LineChart values={[]} direction="flat" format={fmt} aria-label="코스피 30일" />,
    );
    expect(screen.getByRole('img', { name: /코스피 30일.*자료 없음/ })).toBeInTheDocument();
    expect(screen.getByText('자료 없음')).toBeInTheDocument();
    expect(container.querySelector('[data-role="line"]')).toBeNull();
  });

  it('값이 모두 null이어도 "자료 없음"', () => {
    render(<LineChart values={[null, null]} direction="flat" format={fmt} aria-label="코스닥" />);
    expect(screen.getByText('자료 없음')).toBeInTheDocument();
  });

  it('값이 1개면 점 하나만 그린다(선 없음)', () => {
    const { container } = render(
      <LineChart values={[2583.27]} direction="up" format={fmt} aria-label="코스피" />,
    );
    expect(container.querySelector('[data-role="line"]')).toBeNull();
    expect(container.querySelectorAll('[data-role="point"]')).toHaveLength(1);
  });

  it('값이 모두 같으면 평평한 선이다(0으로 나누지 않는다)', () => {
    const { container } = render(
      <LineChart values={[5, 5, 5, 5]} direction="flat" format={fmt} aria-label="보합" />,
    );
    const d = linePath(container);
    expect(d).not.toMatch(/NaN|Infinity/);
    const ys = [...d.matchAll(/[ML]\s*[\d.]+\s+([\d.]+)/g)].map((m) => m[1]);
    expect(ys).toHaveLength(4);
    expect(new Set(ys).size).toBe(1);
  });

  it('null(또는 NaN)은 선을 끊는다', () => {
    const { container } = render(
      <LineChart
        values={[1, 2, null, 3, Number.NaN, 4, 5]}
        direction="up"
        format={fmt}
        aria-label="끊긴 선"
      />,
    );
    const d = linePath(container);
    expect(d.match(/M/g)).toHaveLength(2);
    // 홀로 남은 값(3)은 점으로 보인다. 마지막 값 점과 함께 2개
    expect(container.querySelectorAll('[data-role="point"]')).toHaveLength(2);
  });

  it('마지막 값 표지의 글자는 format(마지막 값), 방향 색은 data-direction', () => {
    const { container } = render(
      <LineChart
        values={[2561.79, 2570.1, 2583.27, null]}
        direction="up"
        format={fmt}
        aria-label="코스피"
      />,
    );
    expect(container.querySelector('[data-role="last-tag"]')).toHaveTextContent('2,583.27');
    expect(container.firstElementChild).toHaveAttribute('data-direction', 'up');
  });

  it('baseline은 점선과 오른쪽 값 표지', () => {
    const { container } = render(
      <LineChart
        values={[2570, 2590, 2583.27]}
        baseline={2561.79}
        direction="up"
        format={fmt}
        aria-label="코스피"
      />,
    );
    const base = container.querySelector('[data-role="baseline"]');
    expect(base).toHaveAttribute('stroke-dasharray');
    expect(container.querySelector('[data-role="baseline-tag"]')).toHaveTextContent('2,561.79');
  });

  it('y축 눈금 3개, x축 라벨은 처음·가운데·끝', () => {
    const labels = ['10/6', '10/7', '10/8', '10/9', '10/10'];
    const { container } = render(
      <LineChart
        values={[1, 3, 2, 5, 4]}
        labels={labels}
        direction="down"
        format={fmt}
        aria-label="지수"
      />,
    );
    expect(container.querySelectorAll('[data-role="y-grid"]')).toHaveLength(3);
    const xs = [...container.querySelectorAll('[data-role="x-label"]')].map((n) => n.textContent);
    expect(xs).toEqual(['10/6', '10/8', '10/10']);
  });

  it('읽기 이름에 처음·끝 값이 든 요약 문장이 있다', () => {
    render(
      <LineChart
        values={[2561.79, null, 2583.27]}
        labels={['10/6', '10/7', '10/8']}
        direction="up"
        format={fmt}
        aria-label="코스피 최근 3일"
      />,
    );
    expect(
      screen.getByRole('img', {
        name: '코스피 최근 3일: 처음 2,561.79(10/6), 끝 2,583.27(10/8), 상승',
      }),
    ).toBeInTheDocument();
  });
});

describe('niceTicks: 보기 좋은 y축 눈금 3개', () => {
  it.each([
    [2461.2, 2600.4, [2500, 2550, 2600]],
    [0, 10, [2, 4, 6]],
    [99, 101, [99.5, 100, 100.5]],
  ])('%s~%s → %o', (lo, hi, expected) => {
    expect(niceTicks(lo, hi)).toEqual(expected);
  });

  it('범위가 0이어도 오류 없이 3개', () => {
    expect(niceTicks(5, 5)).toHaveLength(3);
  });
});
