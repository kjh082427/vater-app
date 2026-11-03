import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PriceChange, SignedNumber } from './SignedNumber';

describe('SignedNumber: 부호, 방향 색, 고정폭 숫자', () => {
  it.each([
    [1200, 'won', '+1,200', 'up'],
    [-3300, 'won', '−3,300', 'down'],
    [0, 'won', '0', 'flat'],
    [2.13, 'usd', '+$2.13', 'up'],
    [-1.87, 'usd', '−$1.87', 'down'],
    [1.71, 'percent', '+1.71%', 'up'],
    [0, 'percent', '0.00%', 'flat'],
    [312_400_000_000, 'eok', '+3,124억', 'up'],
  ] as const)('%s (%s) → %s, %s', (value, format, text, direction) => {
    render(<SignedNumber value={value} format={format} />);
    const el = screen.getByText(text);
    expect(el).toHaveAttribute('data-direction', direction);
    expect(el).toHaveClass('vt-num');
  });

  it('지수처럼 단위 없는 숫자는 decimals 자리까지', () => {
    render(<SignedNumber value={-2.76} format="number" decimals={2} />);
    expect(screen.getByText('−2.76')).toHaveAttribute('data-direction', 'down');
  });

  it('문장 안의 원화 변화량은 unit으로 "원"을 붙인다', () => {
    render(<SignedNumber value={1200} format="won" unit />);
    expect(screen.getByText('+1,200원')).toBeInTheDocument();
  });

  it('값이 없으면 대시를 보여 주고 화면 읽기 프로그램에는 "데이터 없음"을 읽어 준다', () => {
    const { container } = render(<SignedNumber value={null} format="percent" />);
    expect(screen.getByText('데이터 없음')).toBeInTheDocument();
    expect(screen.getByText('—')).toHaveAttribute('aria-hidden', 'true');
    expect(container.firstElementChild).toHaveAttribute('data-direction', 'flat');
  });
});

describe('PriceChange: 변화량과 등락률을 한 덩어리로', () => {
  it('원화: +1,200 (+1.71%), 상승', () => {
    const { container } = render(<PriceChange change={1200} percent={1.71} currency="KRW" />);
    const el = container.firstElementChild;
    expect(el).toHaveTextContent('+1,200 (+1.71%)');
    expect(el).toHaveAttribute('data-direction', 'up');
  });

  it('달러: −$1.87 (−1.36%), 하락', () => {
    const { container } = render(<PriceChange change={-1.87} percent={-1.36} currency="USD" />);
    expect(container.firstElementChild).toHaveTextContent('−$1.87 (−1.36%)');
    expect(container.firstElementChild).toHaveAttribute('data-direction', 'down');
  });

  it('보합: 0 (0.00%)', () => {
    const { container } = render(<PriceChange change={0} percent={0} currency="KRW" />);
    expect(container.firstElementChild).toHaveTextContent('0 (0.00%)');
    expect(container.firstElementChild).toHaveAttribute('data-direction', 'flat');
  });

  it('문장 안에서는 unit으로 +1,200원 (+1.71%)', () => {
    const { container } = render(<PriceChange change={1200} percent={1.71} currency="KRW" unit />);
    expect(container.firstElementChild).toHaveTextContent('+1,200원 (+1.71%)');
  });

  it('변화량이 없으면 등락률의 방향을 따른다', () => {
    const { container } = render(<PriceChange change={null} percent={-0.37} currency="KRW" />);
    expect(container.firstElementChild).toHaveAttribute('data-direction', 'down');
  });
});

describe('tone: 시세 방향이 아닌 부호 숫자는 먹(neutral)', () => {
  it('기본은 direction(방향 색)', () => {
    render(<SignedNumber value={1.71} format="percent" />);
    expect(screen.getByText('+1.71%')).toHaveAttribute('data-tone', 'direction');
  });

  it('neutral: 부호와 고정폭 숫자는 그대로, 색만 먹(예: 목표가 괴리율)', () => {
    render(<SignedNumber value={-3.2} format="percent" tone="neutral" />);
    const el = screen.getByText('−3.20%');
    expect(el).toHaveAttribute('data-tone', 'neutral');
    expect(el).toHaveClass('vt-num');
  });

  it('PriceChange도 같다: 기본 direction, neutral이면 먹', () => {
    const { container, rerender } = render(
      <PriceChange change={1200} percent={1.71} currency="KRW" />,
    );
    expect(container.firstElementChild).toHaveAttribute('data-tone', 'direction');
    rerender(<PriceChange change={1200} percent={1.71} currency="KRW" tone="neutral" />);
    expect(container.firstElementChild).toHaveAttribute('data-tone', 'neutral');
    expect(container.firstElementChild).toHaveTextContent('+1,200 (+1.71%)');
  });
});
