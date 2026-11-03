import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ProgressBar } from './ProgressBar';
import { Toggle } from './Toggle';

function Controlled({ onChange }: { onChange?: (v: boolean) => void }) {
  const [on, setOn] = useState(true);
  return (
    <Toggle
      label="숫자 카드 줄 보이기"
      checked={on}
      onChange={(next) => {
        setOn(next);
        onChange?.(next);
      }}
    />
  );
}

describe('Toggle: 스위치', () => {
  it('switch 역할, 이름은 이름표, 켜짐 상태는 aria-checked', () => {
    render(<Controlled />);
    const sw = screen.getByRole('switch', { name: '숫자 카드 줄 보이기' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('Space로 바꾼다', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    await user.tab();
    expect(screen.getByRole('switch')).toHaveFocus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('누르면 바뀌고, 막혀 있으면 바뀌지 않는다', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<Toggle label="감시" checked={false} onChange={onChange} />);
    await user.click(screen.getByRole('switch', { name: '감시' }));
    expect(onChange).toHaveBeenCalledWith(true);
    onChange.mockClear();
    rerender(<Toggle label="감시" checked={false} onChange={onChange} disabled />);
    expect(screen.getByRole('switch')).toBeDisabled();
    await user.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('ProgressBar: 진행 막대', () => {
  it('progressbar 역할, 이름, 0~100 값', () => {
    render(<ProgressBar value={60} label="분석 진행" />);
    const bar = screen.getByRole('progressbar', { name: '분석 진행' });
    expect(bar).toHaveAttribute('aria-valuenow', '60');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it.each([
    [-5, '0'],
    [140, '100'],
    [Number.NaN, '0'],
    [33.3, '33'],
  ])('값 %s는 %s로 맞춘다', (value, expected) => {
    render(<ProgressBar value={value} label="진행" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', expected);
  });
});
