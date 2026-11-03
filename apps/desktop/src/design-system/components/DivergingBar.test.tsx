import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatEokChange } from '../format/money';
import { DivergingBar } from './DivergingBar';

const rows = [
  { label: '외국인', value: 123_400_000_000 },
  { label: '기관', value: -48_600_000_000 },
  { label: '개인', value: 0 },
];

function bar(container: HTMLElement, label: string) {
  return container.querySelector(`[data-row="${label}"] [data-role="bar"]`);
}

describe('DivergingBar: 0 기준 양방향 막대', () => {
  it('읽기 이름은 제목과 행마다 이름·값', () => {
    render(<DivergingBar rows={rows} format={formatEokChange} aria-label="코스피 수급" />);
    expect(
      screen.getByRole('img', { name: '코스피 수급: 외국인 +1,234억, 기관 −486억, 개인 0.0억' }),
    ).toBeInTheDocument();
  });

  it('양수는 기준선 오른쪽(상승 색), 음수는 왼쪽(하락 색), 길이는 가장 큰 절댓값 기준', () => {
    const { container } = render(
      <DivergingBar rows={rows} format={formatEokChange} aria-label="수급" />,
    );
    const pos = bar(container, '외국인') as HTMLElement;
    const neg = bar(container, '기관') as HTMLElement;
    expect(pos).toHaveAttribute('data-side', 'right');
    expect(pos).toHaveAttribute('data-direction', 'up');
    expect(pos.style.width).toBe('50%');
    expect(neg).toHaveAttribute('data-side', 'left');
    expect(neg).toHaveAttribute('data-direction', 'down');
    expect(parseFloat(neg.style.width)).toBeCloseTo((48.6 / 123.4) * 50, 1);
  });

  it('값 라벨은 같은 방향 색이고, 0은 막대 없이 회색 0', () => {
    const { container } = render(
      <DivergingBar rows={rows} format={formatEokChange} aria-label="수급" />,
    );
    const value = (label: string) =>
      container.querySelector(`[data-row="${label}"] [data-role="value"]`);
    expect(value('외국인')).toHaveAttribute('data-direction', 'up');
    expect(value('기관')).toHaveAttribute('data-direction', 'down');
    expect(bar(container, '개인')).toBeNull();
    expect(value('개인')).toHaveTextContent('0.0억');
    expect(value('개인')).toHaveAttribute('data-direction', 'flat');
  });

  it('모두 0이어도 오류 없이 막대 없음', () => {
    const { container } = render(
      <DivergingBar
        rows={[
          { label: 'A', value: 0 },
          { label: 'B', value: 0 },
        ]}
        format={formatEokChange}
        aria-label="수급"
      />,
    );
    expect(container.querySelectorAll('[data-role="bar"]')).toHaveLength(0);
    expect(container.textContent).not.toMatch(/NaN|Infinity/);
  });

  it('숫자가 아닌 값은 막대 없이 "—"', () => {
    const { container } = render(
      <DivergingBar
        rows={[{ label: 'A', value: Number.NaN }]}
        format={formatEokChange}
        aria-label="수급"
      />,
    );
    expect(container.querySelectorAll('[data-role="bar"]')).toHaveLength(0);
    expect(container.querySelector('[data-role="value"]')).toHaveTextContent('—');
  });
});
