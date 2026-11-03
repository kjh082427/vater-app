import { Select } from '../../design-system';
import { isMetricId } from '../layout/mins';
import type { PanelDoc } from '../layout/types';
import { panelDef } from '../panels/registry';
import type { OptionDef } from '../panels/types';
import { MetricChecklist } from './MetricChecklist';
import styles from './editor.module.css';

type SelectDef = Extract<OptionDef, { kind: 'select' }>;

function SelectField({
  def,
  value,
  onChange,
}: {
  def: SelectDef;
  value: unknown;
  onChange: (v: string) => void;
}) {
  const choices = def.useChoices();
  const current =
    typeof value === 'string' && choices.some((c) => c.value === value) ? value : def.default;
  return <Select label={def.label} value={current} options={choices} onChange={onChange} />;
}

/** 칸 내용의 옵션(시장, 지수, 종목, 숫자 등). */
export function OptionFields({
  panel,
  onChange,
}: {
  panel: PanelDoc;
  onChange: (options: Record<string, unknown>) => void;
}) {
  const defs = panelDef(panel.type)?.options ?? [];
  if (defs.length === 0) return null;
  const set = (key: string, v: unknown) => onChange({ ...panel.options, [key]: v });
  return (
    <div className={styles.options}>
      {defs.map((def) =>
        def.kind === 'select' ? (
          <SelectField
            key={def.key}
            def={def}
            value={panel.options[def.key]}
            onChange={(v) => set(def.key, v)}
          />
        ) : (
          <MetricChecklist
            key={def.key}
            label={`${def.label} 고르기(최대 ${def.max}개)`}
            value={
              Array.isArray(panel.options[def.key])
                ? (panel.options[def.key] as unknown[]).filter(isMetricId)
                : def.default
            }
            max={def.max}
            onChange={(next) => set(def.key, next)}
          />
        ),
      )}
    </div>
  );
}
