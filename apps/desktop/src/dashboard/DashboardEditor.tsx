/**
 * 배치 편집 화면(대시보드 설계 5장 "편집 화면").
 * 위 줄: 배치 편집 · 탭 이름, [취소], [저장]. 오른쪽: ① 칸 수 ② 틀 ③ 맨 위 숫자 줄, 기본 배치로 되돌리기.
 * 캔버스: 칸 번호·내용 이름·[내용 바꾸기 ▾]·옵션, 경계선 손잡이. 맞는지는 실제 대시보드 영역(창 크기)으로 잰다.
 * 저장 실패(422·끊김)면 편집 화면과 바꾼 것을 그대로 두고 사이드카 문구를 보인다.
 */
import { useId, useState, type KeyboardEvent } from 'react';
import type { ApiError } from '../api/errors';
import { Button, Dialog, Icon } from '../design-system';
import { ApiErrorNotice } from '../screens/common/ApiErrorNotice';
import { ContentPicker } from './editor/ContentPicker';
import { CountPicker } from './editor/CountPicker';
import { firstFitting, labelOf, realRects, useWindowArea } from './editor/fit';
import { KpiStripSettings } from './editor/KpiStripSettings';
import { OptionFields } from './editor/OptionFields';
import { TemplatePicker } from './editor/TemplatePicker';
import { defaultDashboard } from './layout/defaults';
import { GAP, withCount } from './layout/geometry';
import { isMetricId, minOf } from './layout/mins';
import { templateRoot } from './layout/templates';
import type { DashboardDoc, Rect } from './layout/types';
import { METRICS } from './panels/metrics';
import { defaultOptions } from './panels/registry';
import { SplitLayout } from './SplitLayout';
import styles from './editor/editor.module.css';

export interface DashboardEditorProps {
  board: DashboardDoc;
  /** 처음 열 때 내용 고르기를 띄울 칸(보기 칸의 [내용 바꾸기]). */
  initialPanel?: number;
  onCancel: () => void;
  /** 저장. 실패하면 ApiError를 던진다(편집 화면은 그대로). */
  onSave: (board: DashboardDoc) => Promise<void>;
}

const px = (n: number) => Math.round(n);

function EditorCell({
  board,
  index,
  real,
  onPick,
  onOptions,
}: {
  board: DashboardDoc;
  index: number;
  real: Rect | undefined;
  onPick: () => void;
  onOptions: (options: Record<string, unknown>) => void;
}) {
  const panel = board.panels[index];
  if (!panel) return null;
  const n = index + 1;
  const empty = panel.type === 'empty';
  const name = empty ? '내용 고르기' : labelOf(panel.type);
  const min = minOf(panel.type);
  return (
    <div
      role="group"
      aria-label={`칸 ${n}: ${name}`}
      className={styles.cell}
      data-empty={empty ? 'true' : 'false'}
    >
      <div className={styles.cellHead}>
        <span className={styles.cellNo} aria-hidden="true">
          {n}
        </span>
        <b className={styles.cellName}>{name}</b>
        <Button size="sm" onClick={onPick} aria-label={`칸 ${n} 내용 바꾸기`}>
          내용 바꾸기 <Icon name="chevron-down" size="sm" />
        </Button>
      </div>
      <OptionFields panel={panel} onChange={onOptions} />
      <p className={`${styles.cellSize} vt-num`}>
        {real
          ? `실제 ${px(real.w)} × ${px(real.h)} · 최소 ${min.w} × ${min.h}`
          : `최소 ${min.w} × ${min.h}`}
      </p>
    </div>
  );
}

export function DashboardEditor({ board, initialPanel, onCancel, onSave }: DashboardEditorProps) {
  const [draft, setDraft] = useState(board);
  const [picking, setPicking] = useState<number | null>(initialPanel ?? null);
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const reasonId = useId();
  const area = useWindowArea(draft.kpi.enabled);

  const count = draft.panels.length;
  const empties = draft.panels.filter((p) => p.type === 'empty').length;
  const dirty = JSON.stringify(draft) !== JSON.stringify(board);
  const rects = realRects(draft.layout.root, area);
  const mins = draft.panels.map((p) => minOf(p.type));

  const change = (next: DashboardDoc) => {
    setDraft(next);
    setError(null);
  };
  const cancel = () => (dirty ? setConfirm(true) : onCancel());
  const save = async () => {
    if (empties > 0 || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
    } catch (e) {
      setError(e as ApiError);
      setSaving(false);
    }
  };

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== 'Escape' || e.defaultPrevented || picking !== null || confirm) return;
    e.preventDefault();
    cancel();
  }

  const items = draft.kpi.items.filter(isMetricId);
  return (
    // 편집 화면 어디서든 Esc = [취소]. 안쪽 목록·대화 상자가 먼저 처리하면(preventDefault) 무시한다.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section aria-label="배치 편집" className={styles.editor} onKeyDown={onKeyDown}>
      <header className={styles.top}>
        <h2 className={styles.title}>{`배치 편집 · ${draft.name}`}</h2>
        <p className={styles.help}>칸 수와 배치 틀을 고르고, 칸마다 보여 줄 내용을 정하세요.</p>
        <div className={styles.topActions}>
          {empties > 0 ? (
            <span id={reasonId} className={styles.reason}>
              {`빈칸 ${empties}개에 내용을 고르세요`}
            </span>
          ) : null}
          <Button onClick={cancel}>취소</Button>
          <Button
            variant="primary"
            icon={<Icon name="check" size="sm" />}
            disabled={empties > 0}
            aria-describedby={empties > 0 ? reasonId : undefined}
            busy={saving}
            onClick={() => void save()}
          >
            저장
          </Button>
        </div>
      </header>
      {error ? <ApiErrorNotice error={error} title="화면 배치를 저장하지 못했습니다" /> : null}
      <div className={styles.body}>
        <div className={styles.stage}>
          {draft.kpi.enabled ? (
            <div className={styles.strip}>
              <b>맨 위 숫자 줄</b>
              <span
                className={styles.stepMeta}
              >{`칸 수와 따로 · 숫자 카드 ${items.length}개`}</span>
              <span className={styles.chips}>
                {items.map((id) => (
                  <span key={id} className={styles.chip}>
                    {METRICS[id].label}
                  </span>
                ))}
              </span>
            </div>
          ) : null}
          <SplitLayout
            className={styles.canvas}
            fitToArea
            root={draft.layout.root}
            mins={mins}
            gap={GAP}
            limitArea={area}
            onResize={(root) => change({ ...draft, layout: { ...draft.layout, root } })}
            renderPanel={(i) => (
              <EditorCell
                board={draft}
                index={i}
                real={rects[i]}
                onPick={() => setPicking(i)}
                onOptions={(options) =>
                  change({
                    ...draft,
                    panels: draft.panels.map((p, j) => (j === i ? { ...p, options } : p)),
                  })
                }
              />
            )}
          />
        </div>
        <aside className={styles.side} aria-label="배치 설정">
          <CountPicker
            count={count}
            onChange={(n) => {
              if (n === count) return;
              const kept = withCount(draft, n, 'one');
              change(withCount(draft, n, firstFitting(n, kept.panels, area)));
            }}
          />
          <TemplatePicker
            count={count}
            value={draft.layout.template}
            panels={draft.panels}
            area={area}
            onChange={(template) =>
              change({ ...draft, layout: { template, root: templateRoot(template) } })
            }
          />
          <KpiStripSettings kpi={draft.kpi} onChange={(kpi) => change({ ...draft, kpi })} />
          <div className={styles.sideFoot}>
            <p className={styles.note}>
              칸 사이의 손잡이를 끌면 비율이 바뀝니다. 내용마다 최소 크기가 있어서 그보다 작아지지
              않습니다.
            </p>
            <Button
              variant="quiet"
              icon={<Icon name="refresh" size="sm" />}
              onClick={() => change(defaultDashboard(draft.id, draft.name))}
            >
              기본 배치로 되돌리기
            </Button>
          </div>
        </aside>
      </div>

      {picking !== null ? (
        <ContentPicker
          index={picking}
          current={draft.panels[picking]?.type ?? 'empty'}
          rect={rects[picking]}
          onClose={() => setPicking(null)}
          onPick={(type) => {
            const i = picking;
            setPicking(null);
            change({
              ...draft,
              panels: draft.panels.map((p, j) =>
                j === i ? { type, options: p.type === type ? p.options : defaultOptions(type) } : p,
              ),
            });
          }}
        />
      ) : null}
      <Dialog
        open={confirm}
        title="바꾼 내용을 버릴까요?"
        onClose={() => setConfirm(false)}
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>계속 편집</Button>
            <Button variant="primary" onClick={onCancel}>
              버리기
            </Button>
          </>
        }
      >
        <p>저장하지 않은 칸 수·배치·내용이 사라지고 편집 전으로 돌아갑니다.</p>
      </Dialog>
    </section>
  );
}
