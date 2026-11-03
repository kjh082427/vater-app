import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { TextField } from './TextField';

function Name({ error, maxLength }: { error?: string; maxLength?: number }) {
  const [value, setValue] = useState('국내 장중');
  return (
    <TextField
      label="탭 이름"
      value={value}
      onChange={setValue}
      hint="1~20자"
      error={error}
      maxLength={maxLength}
    />
  );
}

describe('TextField: 글자 입력', () => {
  it('이름표로 이름 붙은 입력, 도움말이 설명으로 연결된다', () => {
    render(<Name />);
    const input = screen.getByRole('textbox', { name: '탭 이름' });
    expect(input).toHaveValue('국내 장중');
    expect(input).toHaveAccessibleDescription('1~20자');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('입력하면 onChange로 값을 넘긴다', async () => {
    const user = userEvent.setup();
    render(<Name />);
    const input = screen.getByRole('textbox', { name: '탭 이름' });
    await user.clear(input);
    await user.type(input, '미국');
    expect(input).toHaveValue('미국');
  });

  it('오류면 aria-invalid이고 오류 문구가 설명으로 연결된다', () => {
    render(<Name error="이름을 1자 이상 쓰세요." />);
    const input = screen.getByRole('textbox', { name: '탭 이름' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(expect.stringContaining('이름을 1자 이상 쓰세요.'));
    expect(screen.getByText('이름을 1자 이상 쓰세요.')).toBeInTheDocument();
  });

  it('maxLength가 있으면 넘게 쓸 수 없고 남은 글자 수를 보인다', async () => {
    const user = userEvent.setup();
    render(<Name maxLength={8} />);
    const input = screen.getByRole('textbox', { name: '탭 이름' });
    expect(input).toHaveAttribute('maxLength', '8');
    expect(screen.getByText('5/8')).toBeInTheDocument();
    await user.type(input, '12345');
    expect(input).toHaveValue('국내 장중123');
    expect(screen.getByText('8/8')).toBeInTheDocument();
  });

  it('type을 바꿀 수 있다', () => {
    render(<TextField label="개수" type="number" value="3" onChange={() => {}} />);
    expect(screen.getByRole('spinbutton', { name: '개수' })).toHaveValue(3);
  });
});
