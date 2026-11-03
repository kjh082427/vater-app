import { useResource } from '../../api/useResource';
import { Button } from '../../design-system';
import { navigate } from '../../app/router';
import { ScreenHeader } from '../common/ScreenHeader';
import common from '../common/screen.module.css';
import { ActiveAnalyses } from './ActiveAnalyses';
import { BriefingCard } from './BriefingCard';
import { RecentAlerts } from './RecentAlerts';
import { WatchlistSection } from './WatchlistSection';

/** 홈(스펙 9-2): 최근 브리핑, 감시 종목, 진행 중인 분석, 최근 알림 5개. */
export function HomeScreen() {
  const settings = useResource<Record<string, unknown>>('/settings');
  return (
    <>
      <ScreenHeader
        title="홈"
        end={
          <Button variant="primary" onClick={() => navigate({ name: 'analyses' })}>
            새 분석
          </Button>
        }
      />
      <div className={common.twoUp}>
        <div className={common.twoUpGrid}>
          <div className={common.column}>
            <BriefingCard settings={settings.data} />
            <WatchlistSection settings={settings.data} />
          </div>
          <div className={common.column}>
            <ActiveAnalyses />
            <RecentAlerts />
          </div>
        </div>
      </div>
    </>
  );
}
