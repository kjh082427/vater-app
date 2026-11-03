import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from './SegmentedControl';

type Range = '1d' | '5d' | '1m' | '1y';

function Ranges({ onChange }: { onChange?: (v: Range) => void }) {
  const [value, setValue] = useState<Range>('1d');
  return (
    <SegmentedControl<Range>
      label="기간"
      value={value}
      options={[
        { value: '1d', label: '1일' },
        { value: '5d', label: '5일' },
        { value: '1m', label: '1개월', disabled: true },
        { value: '1y', label: '1년' },
      ]}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

describe('SegmentedControl: 라디오 그룹', () => {
  it('radiogroup 이름, 고른 것만 checked이고 Tab 순서에 든다', () => {
    render(<Ranges />);
    expect(screen.getByRole('radiogroup', { name: '기간' })).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ]);
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1, -1]);
  });

  it('→←로 옮기며 바로 고르고, 막힌 것은 건너뛰고, 끝에서 처음으로 돈다', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Ranges onChange={onChange} />);
    await user.tab();
    expect(screen.getByRole('radio', { name: '1일' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('5d');
    expect(screen.getByRole('radio', { name: '5일' })).toHaveFocus();
    expect(screen.getByRole('radio', { name: '5일' })).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('1y');
    await user.keyboard('{ArrowDown}');
    expect(onChange).toHaveBeenLastCalledWith('1d');
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('1y');
    await user.keyboard('{ArrowUp}');
    expect(onChange).toHaveBeenLastCalledWith('5d');
  });

  it('누르면 고르고, 막힌 것은 고를 수 없다', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Ranges onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: '1년' }));
    expect(onChange).toHaveBeenLastCalledWith('1y');
    expect(screen.getByRole('radio', { name: '1개월' })).toBeDisabled();
  });
});
