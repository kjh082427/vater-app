import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { formatWon } from '../format/money';
import { DataTable, type Column } from './DataTable';

interface Row {
  code: string;
  name: string;
  price: number;
}

const rows: Row[] = [
  { code: '005930', name: '삼성전자', price: 71400 },
  { code: '000660', name: 'SK하이닉스', price: 198700 },
  { code: '035420', name: 'NAVER', price: 172300 },
];

const columns: Column<Row>[] = [
  { key: 'name', header: '종목', cell: (r) => r.name },
  { key: 'price', header: '현재가', numeric: true, cell: (r) => formatWon(r.price) },
];

describe('DataTable', () => {
  it('표 이름(caption), 열 머리, 행', () => {
    render(<DataTable caption="감시 종목" columns={columns} rows={rows} rowKey={(r) => r.code} />);
    const table = screen.getByRole('table', { name: '감시 종목' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['종목', '현재가']);
    expect(within(table).getAllByRole('row')).toHaveLength(4);
  });

  it('숫자 열은 머리와 칸 모두 오른쪽 정렬, 고정폭 숫자', () => {
    render(<DataTable caption="감시 종목" columns={columns} rows={rows} rowKey={(r) => r.code} />);
    const header = screen.getByRole('columnheader', { name: '현재가' });
    expect(header).toHaveAttribute('data-align', 'end');
    const cell = screen.getByRole('cell', { name: '71,400원' });
    expect(cell).toHaveAttribute('data-align', 'end');
    expect(cell).toHaveClass('vt-num');
    expect(screen.getByRole('cell', { name: '삼성전자' })).toHaveAttribute('data-align', 'start');
  });

  it('행 동작이 없으면 행은 포커스를 받지 않는다', () => {
    render(<DataTable caption="지수" columns={columns} rows={rows} rowKey={(r) => r.code} />);
    const bodyRows = screen.getAllByRole('row').slice(1);
    expect(bodyRows.every((row) => !row.hasAttribute('tabindex'))).toBe(true);
  });

  it('행 동작이 있으면: 첫 행만 Tab 순서에, ↑↓·Home·End로 이동, Enter·Space·클릭으로 연다', async () => {
    const user = userEvent.setup();
    const onRowActivate = vi.fn();
    render(
      <DataTable
        caption="감시 종목"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.code}
        onRowActivate={onRowActivate}
      />,
    );
    const [, first, second, third] = screen.getAllByRole('row');
    expect([first, second, third].map((r) => r?.tabIndex)).toEqual([0, -1, -1]);

    await user.tab();
    expect(first).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(second).toHaveFocus();
    expect([first, second, third].map((r) => r?.tabIndex)).toEqual([-1, 0, -1]);
    await user.keyboard('{End}');
    expect(third).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(third).toHaveFocus();
    await user.keyboard('{Home}');
    expect(first).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(first).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onRowActivate).toHaveBeenLastCalledWith(rows[0]);
    await user.keyboard('{ArrowDown} ');
    expect(onRowActivate).toHaveBeenLastCalledWith(rows[1]);
    await user.click(screen.getByRole('cell', { name: 'NAVER' }));
    expect(onRowActivate).toHaveBeenLastCalledWith(rows[2]);
    expect(onRowActivate).toHaveBeenCalledTimes(3);
  });

  it('빈 표는 다음에 할 일을 알려 주는 한 줄을 보여 준다', () => {
    render(
      <DataTable
        caption="감시 종목"
        columns={columns}
        rows={[]}
        rowKey={(r) => r.code}
        empty="감시 종목이 없습니다. 종목 추가로 시작하세요."
      />,
    );
    const cell = screen.getByRole('cell', {
      name: '감시 종목이 없습니다. 종목 추가로 시작하세요.',
    });
    expect(cell).toHaveAttribute('colspan', '2');
  });

  it('빈 표도 머리줄의 열 수는 columns 수 그대로이고, 안내 칸은 다른 칸과 같은 여백(td)을 쓴다', () => {
    const { container } = render(
      <DataTable
        caption="감시 종목"
        columns={columns}
        rows={[]}
        rowKey={(r) => r.code}
        empty="감시 종목이 없습니다."
      />,
    );
    expect(screen.getAllByRole('columnheader')).toHaveLength(columns.length);
    expect(container.querySelectorAll('col')).toHaveLength(columns.length);
    // 빈 표는 열 너비를 머리 글자에 맡기지 않고 고르게 나눈다(안내 문장 길이에 머리가 끌려가지 않게)
    expect(container.querySelector('table')).toHaveAttribute('data-empty', 'true');
    const cell = screen.getByRole('cell', { name: '감시 종목이 없습니다.' });
    expect(cell).toHaveClass('td');
    expect(cell).toHaveClass('empty');
    expect(cell).toHaveAttribute('colspan', String(columns.length));
  });

  it('행이 있으면 data-empty가 없다', () => {
    const { container } = render(
      <DataTable caption="지수" columns={columns} rows={rows} rowKey={(r) => r.code} />,
    );
    expect(container.querySelector('table')).not.toHaveAttribute('data-empty');
  });

  it('caption은 기본으로 화면에서 숨기고(구역 제목이 대신한다) 보이게 할 수도 있다', () => {
    const { rerender } = render(
      <DataTable caption="지수" columns={columns} rows={rows} rowKey={(r) => r.code} />,
    );
    expect(screen.getByText('지수').closest('caption')).toHaveAttribute('data-hidden', 'true');
    rerender(
      <DataTable
        caption="지수"
        captionVisible
        columns={columns}
        rows={rows}
        rowKey={(r) => r.code}
      />,
    );
    expect(screen.getByText('지수').closest('caption')).toHaveAttribute('data-hidden', 'false');
  });

  it('행 안의 버튼은 행을 열지 않는다: Enter는 버튼만, 버튼 클릭은 행을 열지 않고, 다른 곳 클릭은 연다', async () => {
    const user = userEvent.setup();
    const onRowActivate = vi.fn();
    const onRemove = vi.fn();
    const withButton: Column<Row>[] = [
      ...columns,
      {
        key: 'remove',
        header: '삭제',
        cell: (r) => (
          <button type="button" onClick={() => onRemove(r.code)}>
            {`${r.name} 삭제`}
          </button>
        ),
      },
    ];
    render(
      <DataTable
        caption="감시 종목"
        columns={withButton}
        rows={rows}
        rowKey={(r) => r.code}
        onRowActivate={onRowActivate}
      />,
    );
    const remove = screen.getByRole('button', { name: '삼성전자 삭제' });
    remove.focus();
    await user.keyboard('{Enter}');
    expect(onRemove).toHaveBeenCalledWith('005930');
    expect(onRowActivate).not.toHaveBeenCalled();

    await user.keyboard(' ');
    expect(onRemove).toHaveBeenCalledTimes(2);
    expect(onRowActivate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'SK하이닉스 삭제' }));
    expect(onRemove).toHaveBeenLastCalledWith('000660');
    expect(onRowActivate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('cell', { name: 'NAVER' }));
    expect(onRowActivate).toHaveBeenCalledWith(rows[2]);
  });
});
