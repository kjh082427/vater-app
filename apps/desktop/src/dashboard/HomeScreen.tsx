/** 홈(대시보드 설계 1장): 사용자가 짜는 대시보드 탭 여러 장과 배치 편집. */
import { useState } from 'react';
import { Button, VisuallyHidden } from '../design-system';
import { DashboardEditor } from './DashboardEditor';
import { DashboardView } from './DashboardView';
import { HomeTabs } from './HomeTabs';
import { useDashboards } from './store';
import styles from './dashboard.module.css';

interface Editing {
  id: string;
  panel?: number;
}

export function HomeScreen({ tab }: { tab?: string }) {
  const store = useDashboards();
  const [editing, setEditing] = useState<Editing | null>(null);
  const board = editing ? store.doc?.dashboards.find((b) => b.id === editing.id) : undefined;

  return (
    <>
      <VisuallyHidden>
        <h1>홈</h1>
      </VisuallyHidden>
      {editing && board && store.doc ? (
        <div className={styles.home}>
          <DashboardEditor
            board={board}
            initialPanel={editing.panel}
            onCancel={() => setEditing(null)}
            onSave={async (next) => {
              const doc = store.doc;
              if (!doc) return;
              await store.save({
                ...doc,
                dashboards: doc.dashboards.map((b) => (b.id === next.id ? next : b)),
              });
              setEditing(null);
            }}
          />
        </div>
      ) : (
        <HomeTabs
          store={store}
          tab={tab}
          actions={(b) => <Button onClick={() => setEditing({ id: b.id })}>배치 편집</Button>}
          renderBoard={(b) => (
            <DashboardView board={b} onChangeContent={(panel) => setEditing({ id: b.id, panel })} />
          )}
        />
      )}
    </>
  );
}
