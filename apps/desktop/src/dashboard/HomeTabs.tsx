/**
 * 홈 = 대시보드 탭 여러 장(대시보드 설계 1장). 탭: 이름 바꾸기, 추가(최대 8장), 삭제(확인, 마지막 1장은
 * 불가), 왼쪽·오른쪽 옮기기. 조작마다 문서를 한 번 저장하고, 실패하면 되돌리고 사이드카 문구를 보인다.
 * 지금 탭은 주소 `#/home?tab=<id>`가 정한다(없거나 모르는 id면 첫 탭).
 */
import { useId, useState, type ReactNode } from 'react';
import type { ApiError } from '../api/errors';
import { navigate } from '../app/router';
import {
  Banner,
  Button,
  Dialog,
  Icon,
  Menu,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TextField,
  type MenuItem,
} from '../design-system';
import { ApiErrorNotice } from '../screens/common/ApiErrorNotice';
import { defaultDashboard } from './layout/defaults';
import type { DashboardDoc, DashboardsDoc } from './layout/types';
import { MAX_DASHBOARDS, MAX_NAME } from './layout/validate';
import { newDashboardId, type DashboardStore } from './store';
import styles from './dashboard.module.css';

export interface HomeTabsProps {
  store: DashboardStore;
  /** 주소의 탭 id. */
  tab?: string;
  renderBoard: (board: DashboardDoc) => ReactNode;
  /** 탭 줄 오른쪽(예: [배치 편집]). */
  actions?: (board: DashboardDoc) => ReactNode;
}

export function nameError(name: string): string | undefined {
  if (name.trim() === '') return '이름을 입력하세요.';
  if (name.length > MAX_NAME) return `이름은 ${MAX_NAME}자까지 쓸 수 있습니다.`;
  return undefined;
}

function nextName(boards: DashboardDoc[]): string {
  const taken = new Set(boards.map((b) => b.name));
  let n = 1;
  while (taken.has(`새 화면 ${n}`)) n++;
  return `새 화면 ${n}`;
}

function move<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

function RenameDialog({
  board,
  onClose,
  onSave,
}: {
  board: DashboardDoc;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(board.name);
  const [error, setError] = useState<string>();
  const submit = () => {
    const problem = nameError(name);
    if (problem) return setError(problem);
    onSave(name.trim());
  };
  return (
    <Dialog
      open
      title="화면 이름 바꾸기"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="primary" onClick={submit}>
            저장
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextField
          label="이름"
          value={name}
          hint={`1~${MAX_NAME}자`}
          error={error}
          onChange={(v) => {
            setName(v);
            setError(undefined);
          }}
        />
      </form>
    </Dialog>
  );
}

export function HomeTabs({ store, tab, renderBoard, actions }: HomeTabsProps) {
  const { doc, status, error, fallback, partial, reload, save } = store;
  const [saveError, setSaveError] = useState<ApiError | null>(null);
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null);
  const reasonId = useId();

  if (status === 'error' && error) {
    return (
      <ApiErrorNotice error={error} title="화면 배치를 불러오지 못했습니다" onRetry={reload} />
    );
  }
  if (!doc) return null;

  const boards = doc.dashboards;
  const index = Math.max(
    0,
    boards.findIndex((b) => b.id === tab),
  );
  const current = boards[index] ?? boards[0];
  if (!current) return null;

  const commit = (next: DashboardsDoc, goTo?: string) => {
    setSaveError(null);
    if (goTo) navigate({ name: 'home', tab: goTo });
    save(next).catch((e: ApiError) => {
      setSaveError(e);
      if (goTo) navigate({ name: 'home', tab: current.id });
    });
  };
  const withBoards = (list: DashboardDoc[]): DashboardsDoc => ({ ...doc, dashboards: list });

  const full = boards.length >= MAX_DASHBOARDS;
  const add = () => {
    const board = defaultDashboard(newDashboardId(), nextName(boards));
    commit(withBoards([...boards, board]), board.id);
  };
  const shift = (by: -1 | 1) => commit(withBoards(move(boards, index, index + by)));

  const items: MenuItem[] = [
    { id: 'rename', label: '이름 바꾸기', onSelect: () => setDialog('rename') },
    {
      id: 'left',
      label: '왼쪽으로 옮기기',
      onSelect: () => shift(-1),
      disabled: index === 0,
      reason: index === 0 ? '이미 맨 왼쪽입니다' : undefined,
    },
    {
      id: 'right',
      label: '오른쪽으로 옮기기',
      onSelect: () => shift(1),
      disabled: index === boards.length - 1,
      reason: index === boards.length - 1 ? '이미 맨 오른쪽입니다' : undefined,
    },
    {
      id: 'delete',
      label: '화면 지우기',
      onSelect: () => setDialog('delete'),
      disabled: boards.length === 1,
      reason: boards.length === 1 ? '마지막 화면은 지울 수 없습니다' : undefined,
    },
  ];

  return (
    <div className={styles.home}>
      {fallback ? (
        <Banner tone="info" title="저장된 화면 배치를 읽지 못해 기본 배치로 열었습니다.">
          화면을 바꿔 저장하면 새 배치로 덮어씁니다.
        </Banner>
      ) : null}
      {partial ? (
        <Banner tone="info" title="일부 화면을 읽지 못했습니다">
          읽은 화면만 열었습니다. 화면을 바꿔 저장하면 읽은 것만 남습니다.
        </Banner>
      ) : null}
      {saveError ? (
        <ApiErrorNotice error={saveError} title="화면 배치를 저장하지 못했습니다" />
      ) : null}
      <Tabs value={current.id} onValueChange={(id) => navigate({ name: 'home', tab: id })}>
        <div className={styles.tabBar}>
          <TabList label="내 화면" className={styles.tabList}>
            {boards.map((b) => (
              <Tab key={b.id} value={b.id}>
                {b.name}
              </Tab>
            ))}
          </TabList>
          <Button
            variant="icon"
            aria-label="화면 추가"
            disabled={full}
            aria-describedby={full ? reasonId : undefined}
            onClick={add}
          >
            <span aria-hidden="true" className={styles.plus}>
              +
            </span>
          </Button>
          {full ? (
            <span id={reasonId} className={styles.tabReason}>
              {`화면은 ${MAX_DASHBOARDS}장까지 만들 수 있습니다`}
            </span>
          ) : null}
          <Menu
            align="start"
            trigger={
              <Button
                variant="icon"
                aria-label={`‘${current.name}’ 화면 메뉴`}
                icon={<Icon name="more" size="sm" />}
              />
            }
            items={items}
          />
          <div className={styles.tabActions}>{actions?.(current)}</div>
        </div>
        <TabPanel value={current.id} className={styles.tabPanel}>
          {renderBoard(current)}
        </TabPanel>
      </Tabs>

      {dialog === 'rename' ? (
        <RenameDialog
          board={current}
          onClose={() => setDialog(null)}
          onSave={(name) => {
            setDialog(null);
            commit(withBoards(boards.map((b) => (b.id === current.id ? { ...b, name } : b))));
          }}
        />
      ) : null}
      <Dialog
        open={dialog === 'delete'}
        title={`‘${current.name}’ 화면을 지울까요?`}
        onClose={() => setDialog(null)}
        footer={
          <>
            <Button onClick={() => setDialog(null)}>취소</Button>
            <Button
              variant="primary"
              onClick={() => {
                setDialog(null);
                const rest = boards.filter((b) => b.id !== current.id);
                const neighbor = rest[Math.min(index, rest.length - 1)] ?? rest[0];
                commit(withBoards(rest), neighbor?.id);
              }}
            >
              지우기
            </Button>
          </>
        }
      >
        <p>칸 배치와 내용이 함께 지워집니다. 되돌릴 수 없습니다.</p>
      </Dialog>
    </div>
  );
}
