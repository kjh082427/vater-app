import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Select, type SelectOption } from './Select';

type Market = 'all' | 'kr' | 'us' | 'jp';

const options: SelectOption<Market>[] = [
  { value: 'all', label: '전체' },
  { value: 'kr', label: '국내' },
  { value: 'jp', label: '일본', disabled: true, reason: '이 버전에서 지원하지 않음' },
  { value: 'us', label: '미국' },
];

function Market({ onChange }: { onChange?: (v: Market) => void }) {
  const [value, setValue] = useState<Market>('kr');
  return (
    <>
      <Select
        label="시장"
        value={value}
        options={options}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
      />
      <button type="button">다음</button>
    </>
  );
}

function trigger() {
  return screen.getByRole('button', { name: /시장/ });
}

describe('Select: 목록 상자(listbox) 고르기', () => {
  it('버튼 이름에 이름표와 지금 값이 들어가고, 닫혀 있다', () => {
    render(<Market />);
    expect(trigger()).toHaveAccessibleName('시장 국내');
    expect(trigger()).toHaveAttribute('aria-haspopup', 'listbox');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('누르면 열리고 지금 값이 선택·활성 항목이다', async () => {
    const user = userEvent.setup();
    render(<Market />);
    await user.click(trigger());
    const listbox = screen.getByRole('listbox', { name: '시장' });
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(listbox).toHaveFocus();
    const kr = screen.getByRole('option', { name: /국내/ });
    expect(kr).toHaveAttribute('aria-selected', 'true');
    expect(listbox).toHaveAttribute('aria-activedescendant', kr.id);
  });

  it('↓↑로 옮기고 막힌 항목은 건너뛴다, Enter로 고르면 닫히고 버튼으로 초점이 돌아간다', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Market onChange={onChange} />);
    await user.click(trigger());
    const listbox = screen.getByRole('listbox');
    await user.keyboard('{ArrowDown}');
    // 국내 다음은 막힌 "일본"을 건너뛰고 "미국"
    expect(listbox).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: /미국/ }).id,
    );
    await user.keyboard('{ArrowUp}');
    expect(listbox).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: /국내/ }).id,
    );
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('us');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
    expect(trigger()).toHaveAccessibleName('시장 미국');
  });

  it('Home·End는 처음·끝의 고를 수 있는 항목으로', async () => {
    const user = userEvent.setup();
    render(<Market />);
    await user.click(trigger());
    const listbox = screen.getByRole('listbox');
    await user.keyboard('{End}');
    expect(listbox).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: /미국/ }).id,
    );
    await user.keyboard('{Home}');
    expect(listbox).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: /전체/ }).id,
    );
  });

  it('Esc는 고르지 않고 닫고 초점을 버튼으로 돌린다', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Market onChange={onChange} />);
    await user.click(trigger());
    await user.keyboard('{ArrowDown}{Escape}');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it('키보드로 연다: 버튼에서 ↓', async () => {
    const user = userEvent.setup();
    render(<Market />);
    await user.tab();
    expect(trigger()).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toHaveFocus();
  });

  it('막힌 항목은 aria-disabled이고 이유가 설명으로 연결된다. 눌러도 고르지 않는다', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Market onChange={onChange} />);
    await user.click(trigger());
    const jp = screen.getByRole('option', { name: /일본/ });
    expect(jp).toHaveAttribute('aria-disabled', 'true');
    expect(jp).toHaveAccessibleDescription('이 버전에서 지원하지 않음');
    await user.click(jp);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('항목을 누르면 고른다', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Market onChange={onChange} />);
    await user.click(trigger());
    await user.click(screen.getByRole('option', { name: /전체/ }));
    expect(onChange).toHaveBeenCalledWith('all');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('바깥을 누르거나 Tab으로 나가면 닫힌다', async () => {
    const user = userEvent.setup();
    render(<Market />);
    await user.click(trigger());
    await user.click(document.body);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await user.click(trigger());
    await user.tab();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
