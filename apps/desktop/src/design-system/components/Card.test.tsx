import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './Button';
import { Card } from './Card';
import { KpiTile } from './KpiTile';

describe('Card: 칸 카드', () => {
  it('제목으로 이름 붙은 구역, h2 제목, 설명 한 줄, 머리 오른쪽 행동, 본문', () => {
    render(
      <Card
        title="감시 종목"
        description="현재가와 수신 상태 · 3종목"
        actions={<Button aria-label="칸 메뉴">⋯</Button>}
      >
        <p>본문</p>
      </Card>,
    );
    const region = screen.getByRole('region', { name: '감시 종목' });
    expect(screen.getByRole('heading', { level: 2, name: '감시 종목' })).toBeInTheDocument();
    expect(region).toHaveTextContent('현재가와 수신 상태 · 3종목');
    expect(screen.getByRole('button', { name: '칸 메뉴' })).toBeInTheDocument();
    expect(region).toHaveTextContent('본문');
  });

  it('aria-label을 주면 그 이름을 쓴다', () => {
    render(
      <Card title="지수 차트" aria-label="칸 1: 지수 차트">
        차트
      </Card>,
    );
    expect(screen.getByRole('region', { name: '칸 1: 지수 차트' })).toBeInTheDocument();
  });

  it('padded={false}면 본문에 여백이 없다(표를 카드 끝까지)', () => {
    const { container, rerender } = render(<Card title="표">본문</Card>);
    expect(container.querySelector('[data-padded]')).toHaveAttribute('data-padded', 'true');
    rerender(
      <Card title="표" padded={false}>
        본문
      </Card>,
    );
    expect(container.querySelector('[data-padded]')).toHaveAttribute('data-padded', 'false');
  });

  it('설명이 없어도 된다', () => {
    render(<Card title="최근 알림">목록</Card>);
    expect(screen.getByRole('region', { name: '최근 알림' })).toHaveTextContent('목록');
  });
});

describe('KpiTile: 숫자 카드', () => {
  it('이름표로 이름 붙은 묶음, 큰 숫자(고정폭), 변화, 미니 차트 자리', () => {
    render(
      <KpiTile
        label="코스피"
        value="2,583.27"
        change={<span>+21.48 +0.84%</span>}
        chart={<svg data-testid="spark" />}
        tag="neutral"
      />,
    );
    const group = screen.getByRole('group', { name: '코스피' });
    expect(group).toHaveTextContent('2,583.27');
    expect(group).toHaveTextContent('+21.48 +0.84%');
    expect(screen.getByText('2,583.27')).toHaveClass('vt-num');
    expect(screen.getByTestId('spark')).toBeInTheDocument();
    // 분류 표지는 중립색 네모(장식)
    const tag = group.querySelector('[data-tag]');
    expect(tag).toHaveAttribute('data-tag', 'neutral');
    expect(tag).toHaveAttribute('aria-hidden', 'true');
  });

  it('변화·차트·표지 없이 숫자만 둘 수 있다', () => {
    const { container } = render(<KpiTile label="오늘 알림" value="2건" />);
    expect(screen.getByRole('group', { name: '오늘 알림' })).toHaveTextContent('2건');
    expect(container.querySelector('[data-tag]')).toBeNull();
  });
});
