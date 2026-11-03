import { useId } from 'react';
import { computeRects } from '../layout/geometry';
import { TEMPLATES, templatesFor } from '../layout/templates';
import type { PanelDoc, Size, TemplateId } from '../layout/types';
import { templateBlock } from './fit';
import styles from './editor.module.css';

/** 틀 그림: 틀의 칸 사각형을 작은 SVG로. */
function Picture({ id }: { id: TemplateId }) {
  const W = 96;
  const H = 60;
  const rects = computeRects(TEMPLATES[id].root, { w: W, h: H }, 4);
  return (
    <svg className={styles.picture} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx={2} />
      ))}
    </svg>
  );
}

function Lock() {
  return (
    <svg className={styles.lock} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" />
    </svg>
  );
}

/** ② 어떤 모양으로 놓을까요: 칸 수에 맞는 틀. 지금 창에 들어가지 않는 틀은 자물쇠와 이유. */
export function TemplatePicker({
  count,
  value,
  panels,
  area,
  onChange,
}: {
  count: number;
  value: TemplateId;
  panels: PanelDoc[];
  area: Size;
  onChange: (id: TemplateId) => void;
}) {
  const name = useId();
  const list = templatesFor(count);
  return (
    <fieldset className={styles.step}>
      <legend className={styles.stepTitle}>
        <span className={styles.stepNo} aria-hidden="true">
          2
        </span>
        어떤 모양으로 놓을까요
        <span className={styles.stepMeta}>{`${count}칸 · ${list.length}가지`}</span>
      </legend>
      <div className={styles.templates}>
        {list.map((id) => {
          const reason = templateBlock(id, panels, area);
          const reasonId = `${name}-${id}`;
          return (
            <label
              key={id}
              className={styles.template}
              data-checked={id === value ? 'true' : 'false'}
              data-blocked={reason ? 'true' : 'false'}
            >
              <input
                type="radio"
                name={name}
                className={styles.radio}
                aria-label={`${TEMPLATES[id].label} 틀`}
                aria-describedby={reason ? reasonId : undefined}
                checked={id === value}
                disabled={reason !== null}
                onChange={() => onChange(id)}
              />
              <span className={styles.pictureWrap}>
                <Picture id={id} />
                {reason ? <Lock /> : null}
              </span>
              <span className={styles.templateName}>{TEMPLATES[id].label}</span>
              {reason ? (
                <span id={reasonId} className={styles.reason}>
                  {reason}
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
