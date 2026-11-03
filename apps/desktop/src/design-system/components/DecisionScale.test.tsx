import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DECISION_LABEL, DecisionScale, type Decision } from './DecisionScale';

function activeCells(container: HTMLElement): number[] {
  return [...container.querySelectorAll('[data-cell]')]
    .filter((cell) => cell.getAttribute('data-active') === 'true')
    .map((cell) => Number(cell.getAttribute('data-cell')));
}

describe('DecisionScale: 의견 눈금 (왼쪽 매도 → 오른쪽 매수, 검토 필요는 눈금 밖)', () => {
  it('사이드카의 결정 값 6개와 한국어 이름이 같다(analysis/summary.py)', () => {
    expect(DECISION_LABEL).toEqual({
      Buy: '매수',
      Overweight: '비중확대',
      Hold: '보유',
      Underweight: '비중축소',
      Sell: '매도',
      REVIEW: '검토 필요',
    });
  });

  it.each([
    ['Sell', '매도', 1, 'down'],
    ['Underweight', '비중축소', 2, 'down'],
    ['Hold', '보유', 3, 'neutral'],
    ['Overweight', '비중확대', 4, 'up'],
    ['Buy', '매수', 5, 'up'],
  ] as const)('%s: "%s", 5칸 중 %s번째 칸, %s 색', (decision, label, cell, tone) => {
    const { container } = render(<DecisionScale decision={decision} />);
    const img = screen.getByRole('img', {
      name: `AI 의견 ${label}: 매도부터 매수까지 5단계 중 ${cell}단계`,
    });
    expect(img).toHaveTextContent(label);
    expect(img).toHaveAttribute('data-tone', tone);
    expect(container.querySelectorAll('[data-cell]')).toHaveLength(5);
    expect(activeCells(container)).toEqual([cell]);
  });

  it('검토 필요: 어느 칸도 채우지 않고 황토색, 눈금 밖이라고 읽어 준다', () => {
    const { container } = render(<DecisionScale decision="REVIEW" />);
    const img = screen.getByRole('img', {
      name: 'AI 의견 검토 필요: 결론을 5단계 눈금에 놓지 못해 사람이 검토해야 합니다',
    });
    expect(img).toHaveTextContent('검토 필요');
    expect(img).toHaveAttribute('data-tone', 'caution');
    expect(activeCells(container)).toEqual([]);
  });

  it('큰 크기(lg)는 눈금 양 끝에 매도·매수를 적는다', () => {
    render(<DecisionScale decision="Hold" size="lg" />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('data-size', 'lg');
    expect(img).toHaveTextContent(/매도.*매수/);
  });

  it('모든 결정을 그릴 수 있다', () => {
    const all = Object.keys(DECISION_LABEL) as Decision[];
    for (const decision of all) {
      const { unmount } = render(<DecisionScale decision={decision} />);
      expect(screen.getByRole('img')).toHaveAttribute('data-decision', decision);
      unmount();
    }
  });
});
