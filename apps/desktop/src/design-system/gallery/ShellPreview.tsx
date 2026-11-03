import { useState } from 'react';
import { AiText } from '../components/AiText';
import { AppShell } from '../components/AppShell';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { DecisionScale } from '../components/DecisionScale';
import { Disclaimer } from '../components/Disclaimer';
import { Icon } from '../components/Icon';
import { MarketState } from '../components/MarketState';
import { Section } from '../components/Section';
import { SidebarNav, type NavItem } from '../components/SidebarNav';
import { StatusBar, StatusBarItem } from '../components/StatusBar';
import { Tab, TabList, TabPanel, Tabs } from '../components/Tabs';
import styles from './gallery.module.css';
import { FlowsLine, IndexTable, WatchTable } from './parts';
import { analysisSummary, brief } from './sample';

export const navItems: NavItem[] = [
  { id: 'home', label: '홈', icon: 'home', href: '#shell' },
  { id: 'analysis', label: '분석', icon: 'analysis', href: '#shell' },
  {
    id: 'alerts',
    label: '감시·알림',
    icon: 'alerts',
    href: '#shell',
    badge: { text: '새 2', label: '새 알림 2건' },
  },
  { id: 'briefing', label: '브리핑', icon: 'briefing', href: '#shell' },
  { id: 'settings', label: '설정', icon: 'settings', href: '#shell' },
];

export function StatusBarSample() {
  return (
    <StatusBar>
      <StatusBarItem>
        <MarketState market="KR" status="open" detail="15:30 마감" variant="inline" />
      </StatusBarItem>
      <StatusBarItem>
        <MarketState market="US" status="closed" detail="23:30 개장" variant="inline" />
      </StatusBarItem>
      <StatusBarItem tone="caution" label="한투 연결" detail="실시간 2 · 폴링 1" />
      <StatusBarItem tone="on" label="AI 엔진" detail="클라우드 전용 · 분석 1건 진행 중" />
      <StatusBarItem align="end">알림 감시 중</StatusBarItem>
    </StatusBar>
  );
}

/**
 * 창 틀 견본(#shell). 최소 창 1024×700과 Windows 배율에서 레이아웃이 깨지지 않는지 보려는
 * 조합이다. 실제 홈 화면은 ui/screens에서 만든다.
 */
export function ShellPreview({ offline }: { offline: boolean }) {
  const [current, setCurrent] = useState('home');
  return (
    <AppShell
      sidebar={
        <SidebarNav
          items={navItems}
          currentId={current}
          onNavigate={setCurrent}
          footer={
            <>
              <span className={styles.sideStatus}>알림 감시 중 · 규칙 7개</span>
              <Button size="sm" icon={<Icon name="pause" size="sm" />}>
                감시 일시 중지
              </Button>
              <span className={styles.serverNote}>한투 실전 서버에 연결됨</span>
            </>
          }
        />
      }
      banner={
        offline ? (
          <Banner
            tone="caution"
            title="오프라인: 알림 감시 일시 중지"
            action={
              <Button size="sm" icon={<Icon name="refresh" size="sm" />}>
                지금 다시 확인
              </Button>
            }
          >
            30초마다 다시 확인합니다. 마지막 수신 14:32:05
          </Banner>
        ) : null
      }
      statusBar={<StatusBarSample />}
    >
      <header className={styles.shellHead}>
        <div>
          <h1 className={styles.screenTitle}>창 틀 견본</h1>
          <p>디자인 시스템 컴포넌트만으로 짠 조합입니다. 예시 데이터입니다.</p>
        </div>
        <div className={styles.shellHeadEnd}>
          <span className={`${styles.stamp} vt-num`}>14:32:05 기준</span>
          <Button variant="primary">새 분석</Button>
        </div>
      </header>
      <div className={styles.twoUp}>
        <div className={styles.twoUpGrid}>
          <div className={styles.column}>
            <Tabs defaultValue="kr">
              <Section
                title="최근 브리핑"
                meta="11월 2일(월) 국내 마감 · 16:00"
                actions={
                  <TabList label="시장" variant="segment">
                    <Tab value="kr">국내</Tab>
                    <Tab value="us">미국</Tab>
                  </TabList>
                }
              >
                <TabPanel value="kr">
                  <div className={styles.stack}>
                    <AiText size="lead">{brief.lead}</AiText>
                    <AiText attribution="AI 해석">{brief.more}</AiText>
                    <IndexTable />
                    <FlowsLine />
                  </div>
                </TabPanel>
                <TabPanel value="us">
                  <AiText size="lead">{brief.usLead}</AiText>
                </TabPanel>
              </Section>
            </Tabs>
            <Section
              title="감시 종목"
              meta="5종목"
              actions={<Button variant="quiet">종목 추가</Button>}
            >
              <WatchTable onOpen={() => undefined} />
            </Section>
          </div>
          <div className={styles.column}>
            <Section title="최근 분석" meta="11월 3일 13:05 완료">
              <div className={styles.summary}>
                <div className={styles.summaryHead}>
                  <b>삼성전자</b>
                  <DecisionScale decision="Overweight" />
                </div>
                <ol className={styles.summaryList}>
                  {analysisSummary.map((line) => (
                    <li key={line}>
                      <AiText as="span">{line}</AiText>
                    </li>
                  ))}
                </ol>
                <Disclaimer analysis />
              </div>
            </Section>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
