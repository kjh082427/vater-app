import { useId } from 'react';
import { Button, Dialog } from '../../design-system';
import type { PanelType } from '../layout/mins';
import type { Rect } from '../layout/types';
import { COMING_SOON, PANELS } from '../panels/registry';
import { contentBlock } from './fit';
import styles from './editor.module.css';

const TYPES = Object.keys(PANELS) as PanelType[];

/** 칸 N에 보여 줄 내용(2열 목록). 칸이 작아 들어가지 않는 내용은 이유와 함께 막고, 시뮬레이션은 "곧 추가". */
export function ContentPicker({
  index,
  current,
  rect,
  onPick,
  onClose,
}: {
  index: number;
  current: string;
  /** 실제 대시보드 영역에서 이 칸의 크기. */
  rect: Rect | undefined;
  onPick: (type: PanelType) => void;
  onClose: () => void;
}) {
  const base = useId();
  return (
    <Dialog
      open
      title={`칸 ${index + 1}에 보여 줄 내용`}
      onClose={onClose}
      footer={<Button onClick={onClose}>닫기</Button>}
    >
      <div className={styles.contents}>
        {TYPES.map((type) => {
          const def = PANELS[type];
          const reason = contentBlock(type, rect);
          const id = `${base}-${type}`;
          return (
            <button
              key={type}
              type="button"
              className={styles.content}
              aria-pressed={type === current}
              aria-disabled={reason ? true : undefined}
              aria-labelledby={`${id}-name ${id}-desc`}
              aria-describedby={reason ? `${id}-why` : undefined}
              onClick={() => {
                if (!reason) onPick(type);
              }}
            >
              <span id={`${id}-name`} className={styles.contentName}>
                {def.label}
              </span>
              <span id={`${id}-desc`} className={styles.contentDesc}>
                {def.description}
              </span>
              {reason ? (
                <span id={`${id}-why`} className={styles.reason}>
                  {reason}
                </span>
              ) : null}
            </button>
          );
        })}
        {COMING_SOON.map((c) => (
          <button
            key={c.id}
            type="button"
            className={styles.content}
            aria-disabled
            aria-labelledby={`${base}-${c.id}-name ${base}-${c.id}-desc`}
            aria-describedby={`${base}-${c.id}-why`}
          >
            <span id={`${base}-${c.id}-name`} className={styles.contentName}>
              {c.label}
            </span>
            <span id={`${base}-${c.id}-desc`} className={styles.contentDesc}>
              {c.description}
            </span>
            <span id={`${base}-${c.id}-why`} className={styles.soon}>
              곧 추가
            </span>
          </button>
        ))}
      </div>
      <p className={styles.note}>이미 다른 칸에 있는 내용도 한 번 더 고를 수 있습니다.</p>
    </Dialog>
  );
}
