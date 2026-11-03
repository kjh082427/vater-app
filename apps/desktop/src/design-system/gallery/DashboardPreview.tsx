import { useState } from 'react';
import { AiText } from '../components/AiText';
import { AppShell } from '../components/AppShell';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Disclaimer } from '../components/Disclaimer';
import { Icon } from '../components/Icon';
import { KpiTile } from '../components/KpiTile';
import { Menu } from '../components/Menu';
import { ProgressBar } from '../components/ProgressBar';
import { SegmentedControl } from '../components/SegmentedControl';
import { Select } from '../components/Select';
import { SidebarNav } from '../components/SidebarNav';
import { SignedNumber } from '../components/SignedNumber';
import { Sparkline } from '../components/Sparkline';
import { Tab, TabList, Tabs } from '../components/Tabs';
import { formatNumber } from '../format/money';
import styles from './dashboard.module.css';
import { FlowsLine, WatchTable } from './parts';
import { brief, indices, watchlist } from './sample';
import { navItems, SidebarFoot, StatusBarSample } from './ShellPreview';

const [kospi, kosdaq] = indices as [(typeof indices)[0], (typeof indices)[0]];

const alerts = [
  {
    id: 'a1',
    text: '삼성전자 현재가 71,400 — 목표가 71,000 이상',
    meta: '11월 3일 13:58 · 가격 알림',
  },
  { id: 'a2', text: 'AI 분석 완료: 삼성전자 — 비중확대', meta: '11월 3일 13:05 · 이벤트' },
  { id: 'a3', text: 'SK하이닉스 RSI(14) 72.4 — 과매수 진입', meta: '11월 2일 16:10 · 지표 알림' },
];

function IndexChange({ row }: { row: (typeof indices)[0] }) {
  return (
    <span className={styles.change}>
      <SignedNumber value={row.change} format="number" decimals={2} />
      <SignedNumber value={row.changePct} format="percent" />
    </span>
  );
}

function PanelMenu() {
  return (
    <Menu
      trigger={<Button variant="icon" aria-label="칸 메뉴" icon={<Icon name="more" />} />}
      items={[
        { id: 'change', label: '내용 바꾸기', onSelect: () => undefined },
        { id: 'refresh', label: '새로 고침', onSelect: () => undefined },
      ]}
    />
  );
}

/**
 * 대시보드 견본(#dashboard): 맨 위 숫자 줄 + 칸 카드 4개(시안 1 "대시보드 라이트"의 장면).
 * 칸 배치 엔진과 칸 내용은 ui/dashboard가 만든다. 여기서는 부품이 한 화면에서 어울리는지만 본다.
 */
export function DashboardPreview() {
  const [market, setMarket] = useState<'all' | 'kr' | 'us'>('kr');
  const [index, setIndex] = useState<'kospi' | 'kosdaq'>('kospi');
  const shown = index === 'kospi' ? kospi : kosdaq;
  return (
    <AppShell
      sidebar={<SidebarNav items={navItems} currentId="home" footer={<SidebarFoot />} />}
      statusBar={<StatusBarSample />}
    >
      <div className={styles.page}>
        <div className={styles.top}>
          <Tabs defaultValue="kr-open">
            <TabList label="대시보드">
              <Tab value="kr-open">국내 장중</Tab>
              <Tab value="us">미국</Tab>
              <Tab value="analysis">분석</Tab>
            </TabList>
          </Tabs>
          <div className={styles.topEnd}>
            <Select
              label="시장"
              value={market}
              onChange={setMarket}
              options={[
                { value: 'all', label: '전체' },
                { value: 'kr', label: '국내 전체' },
                { value: 'us', label: '미국' },
              ]}
            />
            <Button>배치 편집</Button>
          </div>
        </div>
        <div className={styles.kpis}>
          <KpiTile
            tag="neutral"
            label="코스피"
            value={formatNumber(kospi.close, 2)}
            change={<IndexChange row={kospi} />}
            chart={
              <Sparkline
                values={kospi.closes}
                direction="up"
                label="코스피 최근 30일"
                width={48}
                height={22}
              />
            }
          />
          <KpiTile
            tag="neutral"
            label="코스닥"
            value={formatNumber(kosdaq.close, 2)}
            change={<IndexChange row={kosdaq} />}
            chart={
              <Sparkline
                values={kosdaq.closes}
                direction="down"
                label="코스닥 최근 30일"
                width={48}
                height={22}
              />
            }
          />
          <KpiTile
            tag="neutral"
            label="감시 종목"
            value={
              <>
                {watchlist.length}
                <small className={styles.unit}>종목</small>
              </>
            }
            change={<span className={styles.muted}>상승 2 · 하락 2 · 보합 1</span>}
          />
          <KpiTile
            tag="neutral"
            label="오늘 알림"
            value={
              <>
                2<small className={styles.unit}>건</small>
              </>
            }
            change={<span className={styles.muted}>마지막 13:58 · 가격</span>}
          />
          <KpiTile
            tag="neutral"
            label="진행 중인 분석"
            value={
              <>
                1<small className={styles.unit}>건</small>
              </>
            }
            change={<span className={styles.muted}>SK하이닉스 · 8분 50초</span>}
            chart={
              <div className={styles.progress}>
                <ProgressBar value={60} label="SK하이닉스 분석 진행" />
              </div>
            }
          />
        </div>
        <div className={styles.grid}>
          <Card
            title="지수 차트"
            description="최근 30거래일 종가 · 점선은 전일 종가"
            actions={<PanelMenu />}
          >
            <div className={styles.chartBar}>
              <SegmentedControl
                label="지수"
                size="sm"
                value={index}
                onChange={setIndex}
                options={[
                  { value: 'kospi', label: '코스피' },
                  { value: 'kosdaq', label: '코스닥' },
                ]}
              />
              <b className="vt-num">{formatNumber(shown.close, 2)}</b>
              <IndexChange row={shown} />
            </div>
            <div className={styles.chartSlot}>
              <Sparkline
                values={shown.closes}
                direction={shown.change > 0 ? 'up' : 'down'}
                label={`${shown.name} 최근 30일`}
              />
            </div>
          </Card>
          <Card
            title="브리핑 요약"
            description="11월 2일(월) 국내 마감 · 16:00 생성"
            actions={<PanelMenu />}
          >
            <div className={styles.brief}>
              <AiText size="lead" attribution="AI 해석">
                {brief.lead}
              </AiText>
              <FlowsLine />
              <div className={styles.foot}>
                <Disclaimer />
                <Button variant="quiet">브리핑 읽기</Button>
              </div>
            </div>
          </Card>
          <Card
            title="감시 종목"
            description={`현재가와 수신 상태 · ${watchlist.length}종목`}
            actions={<PanelMenu />}
          >
            <WatchTable onOpen={() => undefined} />
          </Card>
          <Card
            title="최근 알림"
            description="오늘 2건 · 가격, 지표, 이벤트"
            actions={<PanelMenu />}
          >
            <ul className={styles.alerts}>
              {alerts.map((alert) => (
                <li key={alert.id}>
                  <p className={styles.alertText}>{alert.text}</p>
                  <p className={`${styles.alertMeta} vt-num`}>{alert.meta}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
