import type { AlertEvent } from '../../api/types';
import { hrefOf } from '../../app/router';
import { kindLabel } from '../../screens/alerts/kinds';
import { formatDayTime } from '../../screens/common/time';
import { useShared } from '../shared';
import { alertEventsSource } from '../sources';
import { PanelEmpty, PanelError, styles } from './common';
import type { PanelProps } from './types';

/** 알림 → 그 종목의 감시·알림. 종목이 없는 알림(이벤트)은 링크 없음. */
export function alertHref(e: AlertEvent): string | null {
  if ((e.market === 'KR' || e.market === 'US') && e.code) {
    return hrefOf({ name: 'symbol', market: e.market, code: e.code });
  }
  return null;
}

/** 칸 높이에 맞춘 줄 수: 머리·바닥을 뺀 높이를 한 줄(약 52px)로 나눠 5~10. */
export function alertRowsFor(height: number): number {
  return Math.min(10, Math.max(5, Math.floor((height - 110) / 52)));
}

export function AlertItem({ e }: { e: AlertEvent }) {
  const href = alertHref(e);
  const meta = [formatDayTime(e.fired_at), e.kind ? kindLabel(e.kind) : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <li>
      {href ? (
        <a className={styles.itemText} href={href}>
          {e.message}
        </a>
      ) : (
        <span className={styles.itemText}>{e.message}</span>
      )}
      <span className={`${styles.itemMeta} vt-num`}>{meta}</span>
    </li>
  );
}

/** 최근 알림: 새로 울린 알림(SSE alert.fired로 위에 더한다). */
export function RecentAlertsPanel({ size }: PanelProps) {
  const events = useShared(alertEventsSource);
  if (events.error) {
    return (
      <PanelError error={events.error} title="알림을 불러오지 못했습니다" onRetry={events.reload} />
    );
  }
  if (!events.data) return <div className={styles.body} aria-busy="true" />;
  if (events.data.length === 0) {
    return (
      <PanelEmpty>
        아직 울린 알림이 없습니다 · <a href="#/alerts">알림 규칙 만들기</a>
      </PanelEmpty>
    );
  }
  const shown = events.data.slice(0, alertRowsFor(size.h));
  return (
    <div className={styles.body}>
      <ol className={styles.list} aria-label="최근 알림">
        {shown.map((e) => (
          <AlertItem key={e.id} e={e} />
        ))}
      </ol>
      <div className={styles.foot}>
        <span />
        <a href="#/alerts">알림 이력 보기 ›</a>
      </div>
    </div>
  );
}
