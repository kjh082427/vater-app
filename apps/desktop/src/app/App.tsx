import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApi, useEvent, useServices, useStreamStatus } from '../api/services';
import { useResource } from '../api/useResource';
import type { CheckOut } from '../api/types';
import { AppShell, Banner, Button, Icon, SidebarNav, type NavItem } from '../design-system';
import { ScreenHeader } from '../screens/common/ScreenHeader';
import { AlertsScreen } from '../screens/alerts/AlertsScreen';
import { AnalysesScreen } from '../screens/analysis/AnalysesScreen';
import { AnalysisDetailScreen } from '../screens/analysis/AnalysisDetailScreen';
import { BriefingDetailScreen } from '../screens/briefing/BriefingDetailScreen';
import { BriefingsScreen } from '../screens/briefing/BriefingsScreen';
import { HomeScreen } from '../screens/home/HomeScreen';
import { formatClock } from '../screens/common/time';
import styles from './app.module.css';
import { AppStatusBar } from './AppStatusBar';
import { useActiveAnalyses, useLastEventAt, useMonitor, useSidecarState } from './hooks';
import { navigate, parseHash, useRoute, type Route } from './router';
import { SidebarFooter } from './SidebarFooter';

const NAV: { id: string; label: string; icon: NavItem['icon']; href: string }[] = [
  { id: 'home', label: '홈', icon: 'home', href: '#/home' },
  { id: 'analyses', label: '분석', icon: 'analysis', href: '#/analyses' },
  { id: 'alerts', label: '감시·알림', icon: 'alerts', href: '#/alerts' },
  { id: 'briefings', label: '브리핑', icon: 'briefing', href: '#/briefings' },
  { id: 'settings', label: '설정', icon: 'settings', href: '#/settings' },
];

/** 라우트 → 사이드바에서 밝힐 메뉴. */
function navOf(route: Route): string {
  switch (route.name) {
    case 'analysis':
      return 'analyses';
    case 'symbol':
      return 'alerts';
    case 'briefing':
      return 'briefings';
    case 'notFound':
    case 'welcome':
      return '';
    default:
      return route.name;
  }
}

const isAlertsRoute = (route: Route) => route.name === 'alerts' || route.name === 'symbol';

/** 셸이 보낸 알림 클릭 경로로 이동한다. 모르는 경로는 무시한다. */
function useShellNavigation() {
  const { platform } = useServices();
  useEffect(
    () =>
      platform.onNavigate((route) => {
        if (parseHash(route).name !== 'notFound') navigate(route);
      }),
    [platform],
  );
}

/** 한투 앱키가 없으면 첫 실행 마법사로 보낸다(앱을 열 때 한 번). 상태를 못 읽으면 보내지 않는다. */
function useWizardRedirect() {
  const api = useApi();
  useEffect(() => {
    let alive = true;
    api.request<Record<string, boolean>>('/secrets').then(
      (secrets) => {
        if (!alive || secrets.KIS_APP_KEY === true) return;
        if (parseHash(window.location.hash).name !== 'welcome') navigate({ name: 'welcome' });
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [api]);
}

/** 다른 화면에 있는 동안 온 알림 수. 감시·알림 화면에 가면 지운다. */
function useAlertBadge(route: Route): number {
  const [count, setCount] = useState(0);
  const onAlerts = isAlertsRoute(route);
  const onAlertsRef = useRef(onAlerts);
  useEffect(() => {
    onAlertsRef.current = onAlerts;
  });
  useEvent('alert.fired', () => {
    if (!onAlertsRef.current) setCount((c) => c + 1);
  });
  useEffect(() => {
    const clear = () => {
      if (isAlertsRoute(parseHash(window.location.hash))) setCount(0);
    };
    window.addEventListener('hashchange', clear);
    return () => window.removeEventListener('hashchange', clear);
  }, []);
  return onAlerts ? 0 : count;
}

function Placeholder({ title }: { title: string }) {
  return (
    <>
      <ScreenHeader title={title} lede="이 화면은 다음 작업에서 채웁니다." />
    </>
  );
}

function NotFound() {
  return (
    <ScreenHeader
      title="화면을 찾을 수 없습니다"
      lede={
        <>
          주소가 바뀌었거나 지워진 화면입니다.{' '}
          <a className={styles.link} href="#/home">
            홈으로
          </a>
        </>
      }
    />
  );
}

function screenFor(route: Route): ReactNode {
  switch (route.name) {
    case 'home':
      return <HomeScreen />;
    case 'analyses':
      return <AnalysesScreen />;
    case 'analysis':
      return <AnalysisDetailScreen key={route.id} id={route.id} />;
    case 'alerts':
      return <AlertsScreen focus={null} />;
    case 'symbol':
      return <AlertsScreen focus={{ market: route.market, code: route.code }} />;
    case 'briefings':
      return <BriefingsScreen />;
    case 'briefing':
      return <BriefingDetailScreen key={route.id} id={route.id} />;
    case 'settings':
      return <Placeholder title="설정" />;
    default:
      return <NotFound />;
  }
}

function Welcome() {
  return (
    <main className={styles.bare}>
      <ScreenHeader
        title="Vater 시작하기"
        lede={
          <>
            첫 실행 마법사는 다음 작업에서 채웁니다.{' '}
            <a className={styles.link} href="#/settings">
              설정 열기
            </a>
          </>
        }
      />
    </main>
  );
}

export function App() {
  const route = useRoute();
  useShellNavigation();
  useWizardRedirect();
  if (route.name === 'welcome') return <Welcome />;
  return <Shell route={route} />;
}

function Shell({ route }: { route: Route }) {
  const { events } = useServices();
  const monitor = useMonitor();
  const sidecar = useSidecarState();
  const stream = useStreamStatus();
  const llm = useResource<CheckOut>('/llm/check');
  const settings = useResource<Record<string, unknown>>('/settings');
  const analyses = useActiveAnalyses();
  const lastEventAt = useLastEventAt();
  const badge = useAlertBadge(route);

  const items: NavItem[] = NAV.map((item) =>
    item.id === 'alerts' && badge > 0
      ? { ...item, badge: { text: `새 ${badge}`, label: `새 알림 ${badge}건` } }
      : item,
  );
  const lastSeen = lastEventAt ? ` 마지막 수신 ${formatClock(lastEventAt)}` : '';

  let banner: ReactNode = null;
  if (sidecar === 'failed' || sidecar === 'stopped') {
    banner = (
      <Banner tone="caution" title="Vater 백그라운드 서비스를 실행하지 못했습니다">
        앱을 완전히 종료(트레이 메뉴 &gt; 종료)한 뒤 다시 실행하세요.
      </Banner>
    );
  } else if (stream === 'disconnected') {
    banner = (
      <Banner
        tone="caution"
        title="연결 끊김: 화면이 최신이 아닐 수 있습니다"
        action={
          <Button
            size="sm"
            icon={<Icon name="refresh" size="sm" />}
            onClick={() => events.reconnect()}
          >
            지금 다시 연결
          </Button>
        }
      >
        {`Vater 백그라운드 서비스에 다시 연결하는 중입니다.${lastSeen}`}
      </Banner>
    );
  } else if (monitor.data?.state === 'offline') {
    banner = (
      <Banner
        tone="caution"
        title="오프라인: 알림 감시 일시 중지"
        action={
          <Button size="sm" icon={<Icon name="refresh" size="sm" />} onClick={monitor.reload}>
            지금 다시 확인
          </Button>
        }
      >
        {`인터넷 연결을 30초마다 다시 확인합니다.${lastSeen}`}
      </Banner>
    );
  }

  return (
    <AppShell
      sidebar={
        <SidebarNav
          items={items}
          currentId={navOf(route)}
          footer={
            <SidebarFooter
              state={monitor.data?.state}
              server={settings.data?.['kis.server']}
              onState={(state) => monitor.mutate((prev) => (prev ? { ...prev, state } : prev))}
            />
          }
        />
      }
      banner={banner}
      statusBar={
        <AppStatusBar
          monitor={monitor.data}
          llm={llm.data}
          llmError={llm.error}
          analyses={analyses}
          lastEventAt={lastEventAt}
        />
      }
    >
      {screenFor(route)}
    </AppShell>
  );
}
