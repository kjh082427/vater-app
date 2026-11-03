import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Icon } from './Icon';

describe('Button', () => {
  it('기본은 secondary, type="button"(폼을 실수로 제출하지 않게)', () => {
    render(<Button>진행 보기</Button>);
    const button = screen.getByRole('button', { name: '진행 보기' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('data-variant', 'secondary');
    expect(button).toHaveAttribute('data-size', 'md');
  });

  it.each(['primary', 'secondary', 'quiet'] as const)('%s 변형', (variant) => {
    render(<Button variant={variant}>새 분석</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('data-variant', variant);
  });

  it('누르면 onClick, 키보드 Enter·Space로도', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>지금 다시 확인</Button>);
    await user.click(screen.getByRole('button'));
    await user.tab();
    await user.tab({ shift: true });
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it('disabled면 누를 수 없다', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        분석 취소
      </Button>,
    );
    await user.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('busy면 aria-busy를 켜고 누를 수 없다(글자로 진행 중임을 말한다)', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button busy onClick={onClick}>
        확인 중…
      </Button>,
    );
    const button = screen.getByRole('button', { name: '확인 중…' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('아이콘은 장식이라 이름에 들어가지 않는다', () => {
    render(<Button icon={<Icon name="pause" />}>감시 일시 중지</Button>);
    expect(screen.getByRole('button', { name: '감시 일시 중지' })).toBeInTheDocument();
  });

  it('작은 크기(sm)', () => {
    render(<Button size="sm">지금 다시 확인</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('data-size', 'sm');
  });
});

describe('Icon', () => {
  it.each([
    'home',
    'analysis',
    'alerts',
    'briefing',
    'settings',
    'pause',
    'play',
    'refresh',
  ] as const)('%s: 장식용 SVG(aria-hidden), 선 1.5', (name) => {
    const { container } = render(<Icon name={name} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('stroke-width', '1.5');
    expect(svg?.querySelectorAll('path, circle').length).toBeGreaterThan(0);
  });
});
