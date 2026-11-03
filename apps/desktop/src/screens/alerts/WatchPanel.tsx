import { useId, useState } from 'react';
import { toApiError, type ApiError } from '../../api/errors';
import { useApi } from '../../api/services';
import type { AlertKindInfo, AlertRule, WatchItem } from '../../api/types';
import { Button } from '../../design-system';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import form from '../common/form.module.css';
import { marketLabel } from '../common/quotes';
import common from '../common/screen.module.css';
import { withObjectParticle } from '../common/text';
import { formatDayTime } from '../common/time';
import styles from './alerts.module.css';
import { ruleSummary, TIMING_LABEL, type Timing } from './kinds';
import { RuleEditor } from './RuleEditor';

export interface WatchPanelProps {
  item: WatchItem;
  rules: AlertRule[];
  kinds: AlertKindInfo[] | undefined;
  expanded: boolean;
  onToggle: () => void;
  /** 규칙이 바뀌었다(만들기·수정·삭제·켜기). */
  onRulesChanged: () => void;
  onRuleUpdated: (rule: AlertRule) => void;
  onRemoved: () => void;
}

function RuleRow({
  item,
  rule,
  onEdit,
  onUpdated,
  onDeleted,
}: {
  item: WatchItem;
  rule: AlertRule;
  onEdit: () => void;
  onUpdated: (rule: AlertRule) => void;
  onDeleted: () => void;
}) {
  const api = useApi();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const summary = ruleSummary(rule.kind, rule.params, item.market);
  const timing = TIMING_LABEL[rule.timing as Timing] ?? rule.timing;

  async function setEnabled(enabled: boolean) {
    setBusy(true);
    setError(null);
    try {
      onUpdated(
        await api.request<AlertRule>(`/alerts/rules/${rule.id}`, {
          method: 'PATCH',
          body: { enabled },
        }),
      );
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.request(`/alerts/rules/${rule.id}`, { method: 'DELETE' });
      onDeleted();
    } catch (e) {
      setError(toApiError(e));
      setBusy(false);
    }
  }

  return (
    <li className={styles.rule}>
      <span className={`${styles.ruleText} ${rule.enabled ? '' : styles.ruleOff}`}>
        <span>{summary}</span>
        <span className={styles.ruleMeta}>
          <span>{timing}</span>
          {rule.last_fired_at ? (
            <>
              {' · '}
              <span className="vt-num">{`마지막 알림 ${formatDayTime(rule.last_fired_at)}`}</span>
            </>
          ) : null}
        </span>
      </span>
      <span className={styles.ruleActions}>
        <label className={form.choice}>
          <input
            type="checkbox"
            checked={rule.enabled}
            disabled={busy}
            aria-label={`${summary} 켜짐`}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span aria-hidden="true">{rule.enabled ? '켜짐' : '꺼짐'}</span>
        </label>
        {confirming ? null : (
          <>
            <Button size="sm" variant="quiet" onClick={onEdit}>
              수정
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setConfirming(true)}>
              삭제
            </Button>
          </>
        )}
      </span>
      {confirming ? (
        <span className={styles.confirm}>
          <span>이 규칙을 지울까요?</span>
          <Button size="sm" busy={busy} onClick={remove}>
            규칙 삭제
          </Button>
          <Button size="sm" variant="quiet" onClick={() => setConfirming(false)}>
            취소
          </Button>
        </span>
      ) : null}
      {error ? (
        <span className={styles.confirm}>
          <ApiErrorNotice error={error} />
        </span>
      ) : null}
    </li>
  );
}

/** 감시 종목 하나: 펼치기 단추, 펼치면 규칙 목록·편집기·빼기. */
export function WatchPanel({
  item,
  rules,
  kinds,
  expanded,
  onToggle,
  onRulesChanged,
  onRuleUpdated,
  onRemoved,
}: WatchPanelProps) {
  const api = useApi();
  const buttonId = useId();
  const panelId = useId();
  // 편집 중인 것: 'new'(새 규칙) 또는 규칙 id
  const [editing, setEditing] = useState<'new' | number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const count = rules.length;

  async function remove() {
    setRemoving(true);
    setError(null);
    try {
      await api.request(`/watchlist/${item.id}`, { method: 'DELETE' });
      onRemoved();
    } catch (e) {
      setError(toApiError(e));
      setRemoving(false);
    }
  }

  function done(saved: boolean) {
    setEditing(null);
    if (saved) onRulesChanged();
  }

  return (
    <li className={styles.watchItem}>
      <h3 className={styles.watchHeading}>
        <button
          id={buttonId}
          type="button"
          className={styles.disclosure}
          aria-expanded={expanded}
          aria-controls={expanded ? panelId : undefined}
          onClick={onToggle}
        >
          <b>{item.name}</b>
          <span
            className={`${common.stockMeta} vt-num`}
          >{`${marketLabel(item.market)} ${item.code}`}</span>
          <span className={styles.count}>{count > 0 ? `규칙 ${count}개` : '규칙 없음'}</span>
          <span className={styles.chevron} aria-hidden="true">
            ›
          </span>
        </button>
      </h3>
      {expanded ? (
        <div id={panelId} role="region" aria-labelledby={buttonId} className={styles.panel}>
          {count === 0 ? (
            <p className={common.empty}>
              아직 규칙이 없습니다. 규칙 추가를 눌러 알림 조건을 만드세요.
            </p>
          ) : (
            <ul className={styles.rules} aria-label={`${item.name} 규칙`}>
              {rules.map((rule) =>
                editing === rule.id && kinds ? (
                  <li key={rule.id}>
                    <RuleEditor item={item} kinds={kinds} rule={rule} onDone={done} />
                  </li>
                ) : (
                  <RuleRow
                    key={rule.id}
                    item={item}
                    rule={rule}
                    onEdit={() => setEditing(rule.id)}
                    onUpdated={onRuleUpdated}
                    onDeleted={onRulesChanged}
                  />
                ),
              )}
            </ul>
          )}
          {editing === 'new' && kinds ? (
            <RuleEditor item={item} kinds={kinds} onDone={done} />
          ) : null}
          {confirmRemove ? (
            <p className={styles.confirm}>
              <span>
                {`${withObjectParticle(item.name)} 감시 목록에서 뺄까요?${count > 0 ? ` 규칙 ${count}개도 함께 지워집니다.` : ''}`}
              </span>
              <Button size="sm" busy={removing} onClick={remove}>
                빼기
              </Button>
              <Button size="sm" variant="quiet" onClick={() => setConfirmRemove(false)}>
                취소
              </Button>
            </p>
          ) : null}
          {error ? <ApiErrorNotice error={error} /> : null}
          <div className={styles.panelFoot}>
            <Button
              size="sm"
              disabled={editing !== null || !kinds}
              onClick={() => setEditing('new')}
            >
              규칙 추가
            </Button>
            {confirmRemove ? null : (
              <Button size="sm" variant="quiet" onClick={() => setConfirmRemove(true)}>
                감시 종목에서 빼기
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </li>
  );
}
