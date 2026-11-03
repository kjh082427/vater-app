import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Dialog } from './Dialog';

function Confirm({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
    onClose?.();
  };
  return (
    <>
      <Button onClick={() => setOpen(true)}>탭 삭제</Button>
      <Dialog
        open={open}
        title="탭을 삭제할까요?"
        onClose={close}
        footer={
          <>
            <Button onClick={close}>취소</Button>
            <Button variant="primary" onClick={close}>
              삭제
            </Button>
          </>
        }
      >
        <p>‘미국’ 탭과 칸 배치가 사라집니다.</p>
      </Dialog>
    </>
  );
}

describe('Dialog: 모달 대화 상자', () => {
  it('닫혀 있으면 그리지 않는다', () => {
    render(<Confirm />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('열면 제목으로 이름 붙은 모달, 안의 첫 버튼에 초점', async () => {
    const user = userEvent.setup();
    render(<Confirm />);
    await user.click(screen.getByRole('button', { name: '탭 삭제' }));
    const dialog = screen.getByRole('dialog', { name: '탭을 삭제할까요?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveTextContent('‘미국’ 탭과 칸 배치가 사라집니다.');
    expect(screen.getByRole('button', { name: '닫기' })).toHaveFocus();
  });

  it('Tab과 Shift+Tab이 대화 상자 안에서만 돈다', async () => {
    const user = userEvent.setup();
    render(<Confirm />);
    await user.click(screen.getByRole('button', { name: '탭 삭제' }));
    const close = screen.getByRole('button', { name: '닫기' });
    const cancel = screen.getByRole('button', { name: '취소' });
    const ok = screen.getByRole('button', { name: '삭제' });
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab();
    expect(ok).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(ok).toHaveFocus();
  });

  it('Esc로 닫고 연 버튼으로 초점이 돌아간다', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Confirm onClose={onClose} />);
    const opener = screen.getByRole('button', { name: '탭 삭제' });
    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('바닥 버튼으로 닫아도 초점이 돌아간다', async () => {
    const user = userEvent.setup();
    render(<Confirm />);
    const opener = screen.getByRole('button', { name: '탭 삭제' });
    await user.click(opener);
    await user.click(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
