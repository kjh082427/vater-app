/** 대시보드 1장 보기: 맨 위 숫자 줄 + 칸 배치(대시보드 설계 1장). */
import { GAP } from './layout/geometry';
import { isMetricId, minOf } from './layout/mins';
import type { DashboardDoc } from './layout/types';
import { KpiStrip } from './panels/KpiStrip';
import { PanelFrame } from './PanelFrame';
import { SplitLayout } from './SplitLayout';
import styles from './dashboard.module.css';

export interface DashboardViewProps {
  board: DashboardDoc;
  /** 칸의 [내용 바꾸기]: 배치 편집을 그 칸의 내용 고르기로 연다. */
  onChangeContent?: (index: number) => void;
}

export function DashboardView({ board, onChangeContent }: DashboardViewProps) {
  const mins = board.panels.map((p) => minOf(p.type));
  return (
    <div className={styles.view}>
      {board.kpi.enabled ? <KpiStrip items={board.kpi.items.filter(isMetricId)} /> : null}
      <SplitLayout
        root={board.layout.root}
        mins={mins}
        gap={GAP}
        renderPanel={(i, rect) => {
          const panel = board.panels[i];
          return panel ? (
            <PanelFrame
              key={`${i}:${panel.type}`}
              panel={panel}
              index={i}
              size={rect}
              onChangeContent={onChangeContent}
            />
          ) : null;
        }}
      />
    </div>
  );
}
