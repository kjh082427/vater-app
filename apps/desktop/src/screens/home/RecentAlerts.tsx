import { useEvent } from '../../api/services';
import { useResource } from '../../api/useResource';
import type { AlertEvent } from '../../api/types';
import { Button, Section } from '../../design-system';
import { hrefOf, navigate } from '../../app/router';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import common from '../common/screen.module.css';
import { formatDayTime } from '../common/time';
import styles from './home.module.css';

const LIMIT = 5;

function linkOf(e: AlertEvent): string | null {
  if ((e.market === 'KR' || e.market === 'US') && e.code) {
    return hrefOf({ name: 'symbol', market: e.market, code: e.code });
  }
  return null;
}

/** 최근 알림 5개: GET /alerts/events?limit=5, 새 알림은 SSE alert.fired로 위에 더한다. */
export function RecentAlerts() {
  const events = useResource<AlertEvent[]>(`/alerts/events?limit=${LIMIT}`, (api) =>
    api.request<AlertEvent[]>('/alerts/events', { query: { limit: LIMIT } }),
  );
  useEvent('alert.fired', (fired) =>
    events.mutate((list) =>
      [fired, ...(list ?? []).filter((e) => e.id !== fired.id)].slice(0, LIMIT),
    ),
  );

  const list = events.data;
  return (
    <Section
      title="최근 알림"
      actions={
        <Button variant="quiet" onClick={() => navigate({ name: 'alerts' })}>
          전체 보기
        </Button>
      }
    >
      {events.error ? (
        <ApiErrorNotice
          error={events.error}
          title="알림을 불러오지 못했습니다"
          onRetry={events.reload}
        />
      ) : null}
      {list && list.length === 0 ? (
        <p className={common.empty}>
          아직 울린 알림이 없습니다. 감시·알림에서 규칙을 만들면 조건이 맞을 때 알려 드립니다.
        </p>
      ) : null}
      {list && list.length > 0 ? (
        <ol className={styles.list}>
          {list.map((e) => {
            const href = linkOf(e);
            return (
              <li key={e.id} className={styles.item}>
                <span className={`${styles.itemMeta} vt-num`}>{formatDayTime(e.fired_at)}</span>
                {href ? (
                  <a className={styles.itemLink} href={href}>
                    {e.message}
                  </a>
                ) : (
                  <span>{e.message}</span>
                )}
              </li>
            );
          })}
        </ol>
      ) : null}
    </Section>
  );
}
