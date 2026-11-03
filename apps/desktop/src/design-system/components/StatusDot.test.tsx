import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FeedStatus } from './FeedStatus';
import { MarketState } from './MarketState';

describe('FeedStatus: 종목별 시세 수신 상태', () => {
  it.each([
    [{ state: 'live' } as const, '실시간'],
    [{ state: 'polling', intervalSeconds: 30 } as const, '폴링 · 30초'],
    [{ state: 'polling' } as const, '폴링'],
    [{ state: 'disconnected' } as const, '끊김 · 재연결 중'],
    [{ state: 'closed' } as const, '장 마감'],
    [{ state: 'idle' } as const, '감시 안 함'],
  ])('%o → "%s"', (props, label) => {
    const { container } = render(<FeedStatus {...props} />);
    const el = container.firstElementChild;
    expect(el).toHaveTextContent(label);
    expect(el).toHaveAttribute('data-state', props.state);
  });

  it('상태 점은 장식이라 읽지 않는다(글자가 상태를 말한다)', () => {
    const { container } = render(<FeedStatus state="live" />);
    const dot = container.querySelector('[data-dot]');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(dot).toHaveAttribute('data-dot', 'on');
  });

  it.each([
    ['live', 'on'],
    ['polling', 'caution'],
    ['disconnected', 'caution-strong'],
    ['closed', 'off'],
    ['idle', 'off'],
  ] as const)('%s의 점 모양은 %s', (state, dot) => {
    const { container } = render(<FeedStatus state={state} />);
    expect(container.querySelector('[data-dot]')).toHaveAttribute('data-dot', dot);
  });
});

describe('MarketState: 시장 개장 상태', () => {
  it.each([
    ['KR', 'open', '국내 장중', 'on'],
    ['KR', 'closed', '국내 마감', 'off'],
    ['KR', 'holiday', '국내 휴장', 'off'],
    ['US', 'open', '미국 장중', 'on'],
    ['US', 'closed', '미국 마감', 'off'],
  ] as const)('%s %s → "%s"', (market, status, label, dot) => {
    const { container } = render(<MarketState market={market} status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.querySelector('[data-dot]')).toHaveAttribute('data-dot', dot);
  });

  it('다음 시각을 덧붙인다: 국내 장중 · 15:30 마감', () => {
    const { container } = render(<MarketState market="KR" status="open" detail="15:30 마감" />);
    expect(container.firstElementChild).toHaveTextContent('국내 장중 15:30 마감');
    expect(screen.getByText('15:30 마감')).toBeInTheDocument();
  });

  it('칩 모양이 기본이고 상태 표시줄 안에서는 inline', () => {
    const { container, rerender } = render(<MarketState market="US" status="closed" />);
    expect(container.firstElementChild).toHaveAttribute('data-variant', 'chip');
    rerender(<MarketState market="US" status="closed" variant="inline" />);
    expect(container.firstElementChild).toHaveAttribute('data-variant', 'inline');
  });
});
