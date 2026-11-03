import { Select, type SelectOption } from '../../design-system';
import styles from './form.module.css';

/** 고르기 칸(디자인 시스템 Select) + 도움말 한 줄. 이름표는 Select 버튼 안 왼쪽에 있다. */
export function SelectField<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles.field}>
      <Select label={label} value={value} options={options} onChange={onChange} />
      {hint ? <span className={styles.hint}>{hint}</span> : null}
    </div>
  );
}
