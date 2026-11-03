import { useState } from 'react';
import { toApiError, type ApiError } from '../api/errors';
import { useApi } from '../api/services';
import type { MonitorState, MonitorStateOut } from '../api/types';
import { Button, Icon, StatusDot } from '../design-system';
import styles from './app.module.css';
import { watchSummary } from './status';

export interface SidebarFooterProps {
  state: MonitorState | undefined;
  /** 설정 kis.server: prod(실전) / vps(모의). */
  server: unknown;
  onState: (state: MonitorState) => void;
}

/** 사이드바 아래쪽: 감시 상태와 일시 중지·재개(트레이 메뉴와 같은 일), 연결한 한투 서버. */
export function SidebarFooter({ state, server, onState }: SidebarFooterProps) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const paused = state === 'paused';

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const out = await api.request<MonitorStateOut>(paused ? '/alerts/resume' : '/alerts/pause', {
        method: 'POST',
      });
      onState(out.state);
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setBusy(false);
    }
  }

  const summary = state ? watchSummary(state) : { tone: 'off' as const, text: '감시 상태 확인 중' };
  return (
    <>
      <span className={styles.sideStatus}>
        <StatusDot tone={summary.tone} />
        {summary.text}
      </span>
      <Button
        size="sm"
        icon={<Icon name={paused ? 'play' : 'pause'} size="sm" />}
        disabled={!state || state === 'offline'}
        busy={busy}
        onClick={toggle}
      >
        {paused ? '감시 재개' : '감시 일시 중지'}
      </Button>
      {error ? (
        <p role="status" className={styles.sideError}>
          {[error.message, error.hint].filter(Boolean).join(' ')}
        </p>
      ) : null}
      {server === 'prod' || server === 'vps' ? (
        <span className={styles.serverNote}>
          {server === 'prod' ? '한투 실전 서버' : '한투 모의 서버'}
        </span>
      ) : null}
    </>
  );
}
