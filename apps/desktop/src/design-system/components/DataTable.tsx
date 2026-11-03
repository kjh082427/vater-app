import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../internal/cx';
import styles from './DataTable.module.css';

export interface Column<Row> {
  key: string;
  header: ReactNode;
  /** 숫자 열: 머리와 칸 모두 오른쪽 정렬, 고정폭 숫자. */
  numeric?: boolean;
  /** 열 너비(CSS 길이, rem 권장). */
  width?: string;
  cell: (row: Row) => ReactNode;
}

export interface DataTableProps<Row> {
  /** 표 이름. 화면 읽기 프로그램이 읽는다. 보통 구역 제목이 대신하므로 화면에서는 숨긴다. */
  caption: string;
  captionVisible?: boolean;
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  /** 있으면 행이 키보드로 포커스를 받고 Enter·Space·클릭으로 연다. */
  onRowActivate?: (row: Row) => void;
  /** 행이 없을 때 보여 줄 한 줄. 다음에 할 일을 알려 준다. */
  empty?: ReactNode;
  className?: string;
}

const MOVE: Record<string, (index: number, last: number) => number> = {
  ArrowDown: (i, last) => Math.min(i + 1, last),
  ArrowUp: (i) => Math.max(i - 1, 0),
  Home: () => 0,
  End: (_, last) => last,
};

/**
 * 데이터 표. 숫자 열은 오른쪽 정렬, 행 높이 40px, 행 사이 가는 선.
 * 행 동작이 있으면 행 하나만 Tab 순서에 들어가고(roving tabindex) ↑↓·Home·End로 옮긴다.
 */
export function DataTable<Row>({
  caption,
  captionVisible = false,
  columns,
  rows,
  rowKey,
  onRowActivate,
  empty,
  className,
}: DataTableProps<Row>) {
  const [active, setActive] = useState(0);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const focusable = Boolean(onRowActivate);
  const current = Math.min(active, Math.max(rows.length - 1, 0));

  function onKeyDown(event: KeyboardEvent<HTMLTableRowElement>, index: number, row: Row) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onRowActivate?.(row);
      return;
    }
    const move = MOVE[event.key];
    if (!move) return;
    event.preventDefault();
    const next = move(index, rows.length - 1);
    setActive(next);
    rowRefs.current[next]?.focus();
  }

  return (
    <table className={cx(styles.table, className)}>
      <caption className={styles.caption} data-hidden={captionVisible ? 'false' : 'true'}>
        {caption}
      </caption>
      <colgroup>
        {columns.map((column) => (
          <col key={column.key} style={column.width ? { width: column.width } : undefined} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              className={styles.th}
              data-align={column.numeric ? 'end' : 'start'}
            >
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td className={styles.empty} colSpan={columns.length}>
              {empty}
            </td>
          </tr>
        ) : (
          rows.map((row, index) => (
            // 행 전체가 하나의 동작이다. 표 의미(행·칸)를 지키려고 tr에 직접 포커스를 준다.
            <tr
              key={rowKey(row)}
              ref={(el) => {
                rowRefs.current[index] = el;
              }}
              className={styles.row}
              tabIndex={focusable ? (index === current ? 0 : -1) : undefined}
              onFocus={focusable ? () => setActive(index) : undefined}
              onKeyDown={focusable ? (event) => onKeyDown(event, index, row) : undefined}
              onClick={focusable ? () => onRowActivate?.(row) : undefined}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cx(styles.td, column.numeric && 'vt-num')}
                  data-align={column.numeric ? 'end' : 'start'}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
