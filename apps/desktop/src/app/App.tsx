import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useEvent, useServices, useStreamStatus } from '../api/services';
import { useResource } from '../api/useResource';
import type { BrokerOut, CheckOut, ConnectionOut } from '../api/types';
import { AppShell, Banner, Button, Icon, SidebarNav, type NavItem } from '../design-system';
import { ScreenHeader } from '../screens/common/ScreenHeader';
import { AlertsScreen } from '../screens/alerts/AlertsScreen';
import { AnalysesScreen } from '../screens/analysis/AnalysesScreen';
import { AnalysisDetailScreen } from '../screens/analysis/AnalysisDetailScreen';
import { BriefingDetailScreen } from '../screens/briefing/BriefingDetailScreen';
import { BriefingsScreen } from '../screens/briefing/BriefingsScreen';
import { HomeScreen } from '../dashboard/HomeScreen';
import { HoldingsScreen } from '../screens/holdings/HoldingsScreen';
import { SettingsScreen } from '../screens/settings/SettingsScreen';
import { WelcomeScreen } from '../screens/welcome/WelcomeScreen';
import { formatClock } from '../screens/common/time';
import styles from './app.module.css';
import { AppStatusBar } from './AppStatusBar';
import { useActiveAnalyses, useLastEventAt, useMonitor, useSidecarState } from './hooks';
import { navigate, parseHash, useRoute, type Route } from './router';
import { SidebarFooter } from './SidebarFooter';

const NAV: { id: string; label: string; icon: NavItem['icon']; href: string }[] = [
  { id: 'home', label: '홈', icon: 'home', href: '#/home' },
  { id: 'analyses', label: '분석', icon: 'analysis', href: '#/analyses' },
  { id: 'holdings', label: '보유 종목', icon: 'holdings', href: '#/holdings' },
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

/**
 * 셸이 보낸 알림 클릭 경로로 이동한다. 모르는 경로는 무시한다.
 * 첫 실행 마법사 중이면 마법사를 벗어나지 않게 미뤘다가, 마법사가 끝나 다른 화면으로 가면 그때 이동한다.
 */
function useShellNavigation(route: Route) {
  const { platform } = useServices();
  const onWelcome = useRef(route.name === 'welcome');
  const pending = useRef<string | null>(null);
  useEffect(() => {
    onWelcome.current = route.name === 'welcome';
    if (!onWelcome.current && pending.current) {
      const target = pending.current;
      pending.current = null;
      navigate(target);
    }
  });
  useEffect(
    () =>
      platform.onNavigate((target) => {
        if (parseHash(target).name === 'notFound') return;
        if (onWelcome.current) pending.current = target;
        else navigate(target);
      }),
    [platform],
  );
}

/**
 * 한투 앱키가 없으면 첫 실행 마법사로 보낸다. 앱을 열 때 확인하고, 그때 사이드카에 닿지 못했으면
 * (시작 중·실패·재시작) 사이드카가 준비될 때 다시 확인한다. 한 번 확인되면 더 묻지 않는다.
 */
function useWizardRedirect() {
  const { api, connection } = useServices();
  useEffect(() => {
    let alive = true;
    let checked = false;
    let checking = false;
    const check = () => {
      if (checked || checking) return;
      checking = true;
      api.request<Record<string, boolean>>('/secrets').then(
        (secrets) => {
          checking = false;
          checked = true;
          if (!alive || secrets.KIS_APP_KEY === true) return;
          if (parseHash(window.location.hash).name !== 'welcome') navigate({ name: 'welcome' });
        },
        () => {
          checking = false; // 닿지 못함: 다음 준비 때 다시
        },
      );
    };
    check();
    const off = connection.onChange((info) => {
      if (info.state === 'ready') check();
    });
    return () => {
      alive = false;
      off();
    };
  }, [api, connection]);
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
      return <HomeScreen tab={route.tab} />;
    case 'analyses':
      return <AnalysesScreen />;
    case 'analysis':
      return <AnalysisDetailScreen key={route.id} id={route.id} />;
    case 'holdings':
      return <HoldingsScreen />;
    case 'alerts':
      return <AlertsScreen focus={null} />;
    case 'symbol':
      return <AlertsScreen focus={{ market: route.market, code: route.code }} />;
    case 'briefings':
      return <BriefingsScreen />;
    case 'briefing':
      return <BriefingDetailScreen key={route.id} id={route.id} />;
    case 'settings':
      return <SettingsScreen />;
    default:
      return <NotFound />;
  }
}

export function App() {
  const route = useRoute();
  useShellNavigation(route);
  useWizardRedirect();
  if (route.name === 'welcome') return <WelcomeScreen />;
  return <Shell route={route} />;
}

function Shell({ route }: { route: Route }) {
  const { events } = useServices();
  const monitor = useMonitor();
  const sidecar = useSidecarState();
  const stream = useStreamStatus();
  const llm = useResource<CheckOut>('/llm/check');
  const settings = useResource<Record<string, unknown>>('/settings');
  const connections = useResource<ConnectionOut[]>('/connections');
  const brokers = useResource<BrokerOut[]>('/brokers');
  const reloadConnections = connections.reload;
  const firstRoute = useRef(true);
  useEffect(() => {
    // 끊김은 화면을 옮길 때 다시 확인한다(알려 주는 SSE 이벤트가 없다)
    if (firstRoute.current) firstRoute.current = false;
    else reloadConnections();
  }, [route.name, reloadConnections]);
  const analyses = useActiveAnalyses();
  const lastEventAt = useLastEventAt();
  const badge = useAlertBadge(route);
  const { platform } = useServices();
  const [logError, setLogError] = useState<string | null>(null);
  const [newVersion, setNewVersion] = useState<string | null>(null);
  useEffect(
    () =>
      platform.onUpdateAvailable((info) => {
        if (info.state === 'available') setNewVersion(info.version);
      }),
    [platform],
  );
  const openLogs = () => {
    setLogError(null);
    platform.openLogFolder().catch((e: unknown) => {
      setLogError(e instanceof Error ? e.message : String(e));
    });
  };

  const items: NavItem[] = NAV.map((item) =>
    item.id === 'alerts' && badge > 0
      ? { ...item, badge: { text: `새 ${badge}`, label: `새 알림 ${badge}건` } }
      : item,
  );
  const lastSeen = lastEventAt ? ` 마지막 수신 ${formatClock(lastEventAt)}` : '';

  let banner: ReactNode = null;
  if (sidecar === 'failed' || sidecar === 'stopped') {
    banner = (
      <Banner
        tone="caution"
        title="Vater 백그라운드 서비스를 실행하지 못했습니다"
        action={
          <Button size="sm" onClick={openLogs}>
            로그 폴더 열기
          </Button>
        }
      >
        {logError ?? '앱을 완전히 종료(트레이 메뉴 > 종료)한 뒤 다시 실행하세요.'}
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
  } else if (sidecar === 'starting') {
    banner = (
      <Banner tone="info" title="Vater 백그라운드 서비스를 시작하는 중입니다">
        준비되면 화면을 다시 불러옵니다.
      </Banner>
    );
  } else if (monitor.data?.state === 'auth_invalid') {
    // 스펙 8장: 한투가 키를 거절하면 감시가 멈춘다. 오프라인(다시 시도)과 달리 사용자가 키를 고쳐야 한다
    banner = (
      <Banner
        tone="caution"
        title="한국투자증권 키를 확인하세요"
        action={
          <a className={styles.bannerLink} href="#/settings">
            설정 열기
          </a>
        }
      >
        한국투자증권이 앱키를 거절해 알림 감시를 멈췄습니다. 설정에서 키를 다시 저장하세요.
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
  } else if (route.name !== 'settings' && connections.data?.some((c) => c.status === 'lost')) {
    // 스펙 1-1: 끊긴 증권사는 알리고 [다시 연결]/[데이터 삭제]는 설정 > 증권사 연결에서 고른다
    const lost = connections.data.filter((c) => c.status === 'lost');
    banner = (
      <Banner
        tone="caution"
        title="증권사 연결이 끊겼습니다"
        action={
          <a className={styles.bannerLink} href="#/settings">
            다시 연결하거나 데이터 삭제
          </a>
        }
      >
        {`저장된 수량은 마지막 갱신 시각과 함께 유지됩니다. 끊긴 곳: ${[
          ...new Set(
            lost.map((c) => brokers.data?.find((b) => b.id === c.broker_id)?.name ?? c.broker_id),
          ),
        ].join(', ')}`}
      </Banner>
    );
  } else if (newVersion && route.name !== 'settings') {
    // 문제가 없을 때만 보이는 안내. 설정 화면에는 설치 버튼이 있으므로 숨긴다
    banner = (
      <Banner
        tone="info"
        title={`새 버전 ${newVersion}이(가) 있습니다`}
        action={
          <a className={styles.bannerLink} href="#/settings">
            설정에서 설치
          </a>
        }
      >
        설치하면 앱이 다시 시작됩니다.
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
              stale={stream === 'disconnected'}
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
          stale={stream === 'disconnected'}
        />
      }
    >
      {screenFor(route)}
    </AppShell>
  );
}
