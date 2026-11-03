import { useState, type FormEvent } from 'react';
import { toApiError, type ApiError } from '../../api/errors';
import { useApi } from '../../api/services';
import type { AlertKindInfo, AlertRule, RulePreviewOut, WatchItem } from '../../api/types';
import { Button, SegmentedControl } from '../../design-system';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import { Field } from '../common/Field';
import form from '../common/form.module.css';
import styles from './alerts.module.css';
import {
  formToParams,
  initialForm,
  KIND_GROUP,
  kindLabel,
  paramFields,
  TIMING_LABEL,
  type FormValues,
  type Timing,
} from './kinds';

export interface RuleEditorProps {
  item: WatchItem;
  kinds: AlertKindInfo[];
  /** 있으면 수정(종류는 바꿀 수 없다, RulePatch). */
  rule?: AlertRule;
  onDone: (saved: boolean) => void;
}

const PREVIEW_STATE = (state: boolean | null) =>
  state === null
    ? '지금은 계산할 수 없습니다'
    : state
      ? '지금 조건을 충족합니다'
      : '지금은 조건을 충족하지 않습니다';

/**
 * 규칙 편집기(스펙 9-2): 종류 → 파라미터(필수·기본값) → 확인 시점 → 미리보기(지금 지표값).
 * 범위 검사는 사이드카가 한다: 422의 message와 hint를 그대로 보인다.
 */
export function RuleEditor({ item, kinds, rule, onDone }: RuleEditorProps) {
  const api = useApi();
  const [kind, setKind] = useState<string>(rule?.kind ?? '');
  const info = kinds.find((k) => k.kind === kind);
  const [values, setValues] = useState<FormValues>(() =>
    info ? initialForm(info, rule?.params) : {},
  );
  const [timing, setTiming] = useState<Timing>(
    (rule?.timing as Timing | undefined) ?? info?.timing ?? 'realtime',
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [preview, setPreview] = useState<RulePreviewOut | null>(null);
  const [previewError, setPreviewError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<'save' | 'preview' | null>(null);

  function chooseKind(next: string) {
    setKind(next);
    const nextInfo = kinds.find((k) => k.kind === next);
    setValues(nextInfo ? initialForm(nextInfo) : {});
    setTiming(nextInfo?.timing ?? 'realtime');
    setFieldErrors({});
    setError(null);
    setPreview(null);
    setPreviewError(null);
  }

  function change(name: string, value: string) {
    setValues((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== name)));
    setPreview(null);
  }

  function parsed() {
    if (!info) {
      setFieldErrors({ kind: '종류를 고르세요.' });
      return null;
    }
    const result = formToParams(info, values);
    if (!result.ok) {
      setFieldErrors(result.errors);
      return null;
    }
    return result.params;
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const params = parsed();
    if (!params) return;
    setBusy('save');
    setError(null);
    try {
      if (rule) {
        await api.request(`/alerts/rules/${rule.id}`, {
          method: 'PATCH',
          body: { params, timing },
        });
      } else {
        await api.request('/alerts/rules', {
          method: 'POST',
          body: { watchlist_id: item.id, kind, params, timing, enabled: true },
        });
      }
      onDone(true);
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setBusy(null);
    }
  }

  async function runPreview() {
    const params = parsed();
    if (!params) return;
    setBusy('preview');
    setPreviewError(null);
    try {
      setPreview(
        await api.request<RulePreviewOut>('/alerts/rules/preview', {
          method: 'POST',
          body: { watchlist_id: item.id, kind, params, timing },
        }),
      );
    } catch (e) {
      setPreview(null);
      setPreviewError(toApiError(e));
    } finally {
      setBusy(null);
    }
  }

  const title = rule ? '규칙 수정' : '새 규칙';
  const fields = info ? paramFields(info, item.market) : [];
  return (
    <form aria-label={title} className={styles.editor} onSubmit={save} noValidate>
      <span className={styles.editorTitle}>{title}</span>
      <Field label="종류" error={fieldErrors.kind}>
        {(control) => (
          <select
            {...control}
            className={form.control}
            value={kind}
            disabled={Boolean(rule)}
            onChange={(e) => chooseKind(e.target.value)}
          >
            <option value="">종류를 고르세요</option>
            {kinds.map((k) => (
              <option key={k.kind} value={k.kind}>
                {KIND_GROUP[k.kind]
                  ? `${KIND_GROUP[k.kind]} · ${kindLabel(k.kind)}`
                  : kindLabel(k.kind)}
              </option>
            ))}
          </select>
        )}
      </Field>

      {info ? (
        <>
          {fields.length > 0 ? (
            <div className={form.row}>
              {fields.map((f) => (
                <Field key={f.name} label={f.label} error={fieldErrors[f.name]}>
                  {(control) =>
                    f.type === 'select' ? (
                      <select
                        {...control}
                        className={form.control}
                        value={values[f.name] ?? ''}
                        onChange={(e) => change(f.name, e.target.value)}
                      >
                        {f.options?.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        {...control}
                        className={`${form.control} ${f.type === 'number' ? form.numeric : ''}`}
                        type="text"
                        inputMode={f.type === 'number' ? 'decimal' : undefined}
                        autoComplete="off"
                        value={values[f.name] ?? ''}
                        onChange={(e) => change(f.name, e.target.value)}
                      />
                    )
                  }
                </Field>
              ))}
            </div>
          ) : null}

          <div className={form.choices}>
            <span className={form.legend} aria-hidden="true">
              확인 시점
            </span>
            <SegmentedControl
              label="확인 시점"
              value={timing}
              options={(['realtime', 'close'] as const).map((t) => ({
                value: t,
                label: TIMING_LABEL[t],
              }))}
              onChange={(t) => {
                setTiming(t);
                setPreview(null);
              }}
            />
          </div>

          {preview ? (
            <div className={styles.preview} role="status">
              <span>{preview.message}</span>
              <span className={styles.previewState}>{PREVIEW_STATE(preview.state)}</span>
            </div>
          ) : null}
          {previewError ? (
            <ApiErrorNotice error={previewError} title="미리보기를 하지 못했습니다" />
          ) : null}
        </>
      ) : null}

      {error ? <ApiErrorNotice error={error} /> : null}

      <div className={form.actions}>
        <Button type="submit" busy={busy === 'save'}>
          {busy === 'save' ? '저장 중…' : '저장'}
        </Button>
        {info ? (
          <Button busy={busy === 'preview'} onClick={runPreview}>
            {busy === 'preview' ? '확인 중…' : '현재 값 미리보기'}
          </Button>
        ) : null}
        <Button variant="quiet" onClick={() => onDone(false)}>
          취소
        </Button>
      </div>
    </form>
  );
}
