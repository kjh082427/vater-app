import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Menu } from './Menu';

function setup() {
  const change = vi.fn();
  const refresh = vi.fn();
  const remove = vi.fn();
  render(
    <Menu
      trigger={<Button aria-label="칸 메뉴">⋯</Button>}
      items={[
        { id: 'change', label: '내용 바꾸기', onSelect: change },
        {
          id: 'remove',
          label: '칸 지우기',
          onSelect: remove,
          disabled: true,
          reason: '칸이 하나뿐',
        },
        { id: 'refresh', label: '새로 고침', onSelect: refresh },
      ]}
    />,
  );
  return { change, refresh, remove, trigger: screen.getByRole('button', { name: '칸 메뉴' }) };
}

describe('Menu: 트리거 버튼에서 여는 메뉴', () => {
  it('트리거는 aria-haspopup="menu", 닫혀 있다', () => {
    const { trigger } = setup();
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('누르면 열리고 첫 항목에 초점, ↓↑는 막힌 항목을 건너뛰며 돈다', async () => {
    const user = userEvent.setup();
    const { trigger } = setup();
    await user.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitem', { name: '내용 바꾸기' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: '새로 고침' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: '내용 바꾸기' })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: '새로 고침' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('menuitem', { name: '내용 바꾸기' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: '새로 고침' })).toHaveFocus();
  });

  it('Enter로 고르면 부르고, 닫고, 트리거로 초점이 돌아간다', async () => {
    const user = userEvent.setup();
    const { trigger, refresh } = setup();
    await user.click(trigger);
    await user.keyboard('{End}{Enter}');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('Esc로 닫고 트리거로 초점이 돌아간다', async () => {
    const user = userEvent.setup();
    const { trigger, change } = setup();
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(change).not.toHaveBeenCalled();
  });

  it('키보드로 연다: 트리거에서 Enter', async () => {
    const user = userEvent.setup();
    const { trigger } = setup();
    await user.tab();
    expect(trigger).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menuitem', { name: '내용 바꾸기' })).toHaveFocus();
  });

  it('막힌 항목은 aria-disabled + 이유, 눌러도 부르지 않는다', async () => {
    const user = userEvent.setup();
    const { trigger, remove } = setup();
    await user.click(trigger);
    const item = screen.getByRole('menuitem', { name: '칸 지우기' });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveAccessibleDescription('칸이 하나뿐');
    await user.click(item);
    expect(remove).not.toHaveBeenCalled();
  });

  it('바깥을 누르면 닫힌다', async () => {
    const user = userEvent.setup();
    const { trigger } = setup();
    await user.click(trigger);
    await user.click(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('항목을 누르면 부르고 닫힌다', async () => {
    const user = userEvent.setup();
    const { trigger, change } = setup();
    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: '내용 바꾸기' }));
    expect(change).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
