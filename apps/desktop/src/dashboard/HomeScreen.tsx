/** 홈(대시보드 설계 1장): 사용자가 짜는 대시보드 탭 여러 장. */
import { VisuallyHidden } from '../design-system';
import { DashboardView } from './DashboardView';
import { HomeTabs } from './HomeTabs';
import { useDashboards } from './store';

export function HomeScreen({ tab }: { tab?: string }) {
  const store = useDashboards();
  return (
    <>
      <VisuallyHidden>
        <h1>홈</h1>
      </VisuallyHidden>
      <HomeTabs store={store} tab={tab} renderBoard={(board) => <DashboardView board={board} />} />
    </>
  );
}
