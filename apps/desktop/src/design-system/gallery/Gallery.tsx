import { useState, type ReactNode } from 'react';
import { AiText } from '../components/AiText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { DataTable, type Column } from '../components/DataTable';
import { Dialog } from '../components/Dialog';
import { DECISION_LABEL, DecisionScale, type Decision } from '../components/DecisionScale';
import { Disclaimer } from '../components/Disclaimer';
import { DivergingBar } from '../components/DivergingBar';
import { FeedStatus } from '../components/FeedStatus';
import { Icon } from '../components/Icon';
import { LineChart } from '../components/LineChart';
import { MarketState } from '../components/MarketState';
import { Menu } from '../components/Menu';
import { ProgressBar } from '../components/ProgressBar';
import { Section } from '../components/Section';
import { SegmentedControl } from '../components/SegmentedControl';
import { Select } from '../components/Select';
import { SidebarNav } from '../components/SidebarNav';
import { PriceChange, SignedNumber } from '../components/SignedNumber';
import { Sparkline } from '../components/Sparkline';
import { Tab, TabList, TabPanel, Tabs } from '../components/Tabs';
import { TextField } from '../components/TextField';
import { Toggle } from '../components/Toggle';
import {
  formatEokChange,
  formatEok,
  formatNumber,
  formatPercent,
  formatSigned,
  formatUsd,
  formatUsdChange,
  formatWon,
  formatWonChange,
  MISSING,
} from '../format/money';
import styles from './gallery.module.css';
import { FlowsLine, IndexTable, WatchTable } from './parts';
import { analysisSummary, brief, flows, indices, watchlist } from './sample';
import { navItems, SidebarFoot, StatusBarSample } from './ShellPreview';

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.label}>{label}</div>
      <div>{children}</div>
    </div>
  );
}

/* ---------- 색 ---------- */

/** [토큰, 역할, 대비를 잴 바탕(없으면 흰 카드, 'bg'면 바탕 색이라 재지 않음)] */
const COLOR_GROUPS: { name: string; tokens: [string, string, string?][] }[] = [
  {
    name: '바탕',
    tokens: [
      ['--color-canvas', '캔버스: 본문 바탕'],
      ['--color-card', '칸 카드, 사이드바, 상태 표시줄'],
      ['--color-row-alt', '표 교차 행, 막힌 버튼'],
      ['--color-hover', '호버'],
      ['--color-selection', '글자 선택'],
    ],
  },
  {
    name: '강조(하나)',
    tokens: [
      ['--color-accent', '주 버튼, 활성 탭, 링크, 포커스'],
      ['--color-accent-strong', '주 버튼 호버, 선택 글자'],
      ['--color-accent-weak', '선택 바탕', 'bg'],
    ],
  },
  {
    name: '표 머리줄',
    tokens: [
      ['--color-table-head', '머리줄 바탕'],
      ['--color-on-table-head', '머리줄 글자', '--color-table-head'],
    ],
  },
  {
    name: '선과 중립 표지',
    tokens: [
      ['--color-line', '칸막이, 경계'],
      ['--color-rule', '행 구분선'],
      ['--color-control', '버튼·입력 테두리'],
      ['--color-control-strong', '꺼진 스위치, 빈 원'],
      ['--color-tag', '분류 표지, 메뉴 아이콘'],
    ],
  },
  {
    name: '글자(먹)',
    tokens: [
      ['--color-ink', '글자'],
      ['--color-ink-2', '보조 글자'],
      ['--color-ink-3', '셋째 글자, 이름표'],
    ],
  },
  {
    name: '값의 방향(전용)',
    tokens: [
      ['--color-up', '상승 숫자, 선'],
      ['--color-down', '하락 숫자, 선'],
    ],
  },
  {
    name: '주의(황토)',
    tokens: [
      ['--color-caution', '폴링 점, 배너 선'],
      ['--color-caution-ink', '주의 글자'],
      ['--color-caution-bg', '배너 바탕'],
    ],
  },
];

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 빌드가 줄인 #fff 같은 3자리 hex를 6자리로. */
function hex6(value: string): string {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : value;
}

function ratio(rawA: string, rawB: string): string {
  const [a, b] = [hex6(rawA), hex6(rawB)];
  if (!/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) return MISSING;
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return `${((hi + 0.05) / (lo + 0.05)).toFixed(2)}:1`;
}

/** 토큰 값은 CSS에서 읽는다. 견본이 tokens.css와 어긋나지 않게. */
function readTokenValues(): Map<string, string> {
  const style = getComputedStyle(document.documentElement);
  const names = COLOR_GROUPS.flatMap((g) => g.tokens.map(([name]) => name));
  names.push('--color-card');
  return new Map(names.map((name) => [name, style.getPropertyValue(name).trim()]));
}

function Colors() {
  const [values] = useState(readTokenValues);
  const paper = values.get('--color-card') ?? '';
  return (
    <Section title="색" meta="역할 이름의 토큰. 대비는 흰 카드 위에서 잰 값">
      {COLOR_GROUPS.map((group) => (
        <div key={group.name} className={styles.swatchGroup}>
          <h3 className={styles.groupName}>{group.name}</h3>
          <div className={styles.swatches}>
            {group.tokens.map(([name, role, against]) => (
              <div key={name} className={styles.swatch}>
                <div className={styles.chip} style={{ background: `var(${name})` }} />
                <div className={styles.swatchText}>
                  <b>{role}</b>
                  <code>{name}</code>
                  <span className="vt-num">
                    {hex6(values.get(name) ?? '') || MISSING} ·{' '}
                    {group.name === '바탕' || name.endsWith('-bg') || against === 'bg'
                      ? '바탕'
                      : ratio(values.get(name) ?? '', values.get(against ?? '') ?? paper)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </Section>
  );
}

/* ---------- 글자 ---------- */

function Typography() {
  return (
    <Section title="글자" meta="Pretendard 하나. 굵기와 크기로 위계를 만든다">
      <div className={styles.rows}>
        <Row label="화면 제목 · 22/28 굵게">
          <p className={styles.screenTitle}>감시·알림</p>
        </Row>
        <Row label="카드 제목 · 16/24 반굵게">
          <p className={styles.sectionTitle}>최근 브리핑</p>
        </Row>
        <Row label="본문 · 14/20">
          <p>알림 규칙 7개가 감시 중입니다. 조건을 넘으면 Windows 알림으로 알려 드립니다.</p>
        </Row>
        <Row label="보조 · 12/16">
          <p className={styles.small}>11월 2일(월) 국내 마감 · 16:00</p>
        </Row>
        <Row label="숫자 · 고정폭(tnum), 오른쪽 정렬">
          <div className={`${styles.numbers} vt-num`}>
            <span>2,583.27</span>
            <span>71,400원</span>
            <span>$227.48</span>
            <span>742.15</span>
            <span>198,700원</span>
            <span>$1,135.40</span>
          </div>
        </Row>
        <Row label="비교: 비례 숫자(쓰지 않음)">
          <div className={`${styles.numbers} ${styles.numbersProportional}`}>
            <span>2,583.27</span>
            <span>71,400원</span>
            <span>$227.48</span>
            <span>742.15</span>
            <span>198,700원</span>
            <span>$1,135.40</span>
          </div>
        </Row>
        <Row label="AI 첫 문장 · 16/24 반굵게 + 꼬리표">
          <AiText size="lead">{brief.lead}</AiText>
        </Row>
        <Row label="AI 본문 · 14/22">
          <AiText attribution="AI 해석">{brief.more}</AiText>
        </Row>
        <Row label="워드마크 · 20 굵게">
          <span className={styles.wordmark}>Vater</span>
        </Row>
      </div>
    </Section>
  );
}

/* ---------- 간격과 선 ---------- */

const SPACES = ['1', '2', '3', '4', '5', '6', '8', '10'];

function SpacingAndRules() {
  return (
    <Section title="간격과 선" meta="4px 격자, rem 단위. 선 굵기만 px">
      <div className={styles.rows}>
        <Row label="간격 --space-*">
          <div className={styles.stack}>
            {SPACES.map((step) => (
              <span key={step} className={styles.spaceBar}>
                <code>--space-{step}</code>
                <i style={{ width: `var(--space-${step})` }} />
              </span>
            ))}
          </div>
        </Row>
        <Row label="선: 경계 1px(line) / 행 1px(rule)">
          <div className={styles.ruleDemo}>
            <div className={styles.ruleLine} />
            <div className={styles.ruleRow} />
          </div>
        </Row>
        <Row label="모서리: 칩 4 · 버튼·입력 6 · 칸 카드 8 · 메뉴·대화 상자 10">
          <div className={styles.radiusRow}>
            <div className={styles.radiusDemo} data-r="sm" />
            <div className={styles.radiusDemo} data-r="control" />
            <div className={styles.radiusDemo} data-r="md" />
            <div className={styles.radiusDemo} data-r="pop" />
          </div>
        </Row>
        <Row label="움직임">
          <p className={styles.small}>
            상태가 바뀔 때만 120~180ms. 움직임 줄이기 설정에서는 0. 들어오는 연출은 없다.
          </p>
        </Row>
      </div>
    </Section>
  );
}

/* ---------- 숫자 표기 ---------- */

interface FormatRow {
  fn: string;
  input: string;
  output: string;
}

const formatRows: FormatRow[] = [
  { fn: 'formatWon', input: '71400', output: formatWon(71400) },
  { fn: 'formatWonChange', input: '1200', output: formatWonChange(1200) },
  { fn: 'formatWonChange(unit)', input: '-3300', output: formatWonChange(-3300, { unit: true }) },
  { fn: 'formatUsd', input: '227.48', output: formatUsd(227.48) },
  { fn: 'formatUsdChange', input: '-1.87', output: formatUsdChange(-1.87) },
  { fn: 'formatPercent', input: '1.71', output: formatPercent(1.71) },
  { fn: 'formatPercent', input: '0', output: formatPercent(0) },
  { fn: 'formatNumber', input: '2583.27, 2', output: formatNumber(2583.27, 2) },
  { fn: 'formatSigned', input: '21.48, 2', output: formatSigned(21.48, 2) },
  { fn: 'formatEokChange', input: '312400000000', output: formatEokChange(312_400_000_000) },
  { fn: 'formatWon', input: 'null', output: formatWon(null) },
];

const formatColumns: Column<FormatRow>[] = [
  { key: 'fn', header: '함수', cell: (r) => <code>{r.fn}</code> },
  { key: 'input', header: '입력', numeric: true, cell: (r) => r.input },
  { key: 'output', header: '결과', numeric: true, cell: (r) => r.output },
];

function Numbers() {
  return (
    <Section title="숫자 표기" meta="스펙 9-1. 부호는 + 와 빼기 기호 −(U+2212)">
      <div className={styles.rows}>
        <Row label="SignedNumber: 원화, 달러, 등락률">
          <div className={styles.inline}>
            <SignedNumber value={1200} format="won" />
            <SignedNumber value={-3300} format="won" />
            <SignedNumber value={0} format="won" />
            <SignedNumber value={2.13} format="usd" />
            <SignedNumber value={-1.87} format="usd" />
            <SignedNumber value={1.71} format="percent" />
            <SignedNumber value={-0.37} format="percent" />
            <SignedNumber value={0} format="percent" />
          </div>
        </Row>
        <Row label="지수, 억 단위, 값 없음">
          <div className={styles.inline}>
            <SignedNumber value={21.48} format="number" decimals={2} />
            <SignedNumber value={-2.76} format="number" decimals={2} />
            <SignedNumber value={312_400_000_000} format="eok" />
            <SignedNumber value={-98_700_000_000} format="eok" />
            <SignedNumber value={null} format="percent" />
          </div>
        </Row>
        <Row label='tone="neutral": 시세 방향이 아닌 부호 숫자(목표가 괴리율)'>
          <div className={styles.inline}>
            <SignedNumber value={-3.2} format="percent" tone="neutral" />
            <SignedNumber value={12.4} format="percent" tone="neutral" />
            <SignedNumber value={0} format="percent" tone="neutral" />
          </div>
        </Row>
        <Row label="PriceChange: 한 덩어리">
          <div className={styles.inline}>
            {watchlist.map((r) => (
              <PriceChange
                key={r.code}
                change={r.change}
                percent={r.changePct}
                currency={r.currency}
              />
            ))}
          </div>
        </Row>
        <Row label="함수 결과(format/money.ts)">
          <DataTable
            caption="숫자 표기 함수"
            columns={formatColumns}
            rows={formatRows}
            rowKey={(r) => `${r.fn}${r.input}`}
          />
        </Row>
      </div>
    </Section>
  );
}

/* ---------- 의견 눈금 ---------- */

const DECISIONS = Object.keys(DECISION_LABEL) as Decision[];

function Decisions() {
  return (
    <Section title="의견 눈금" meta="왼쪽 매도 → 오른쪽 매수. 검토 필요는 눈금 밖">
      <div className={styles.rows}>
        <Row label="기본(목록, 알림 안)">
          <div className={styles.inline}>
            {DECISIONS.map((d) => (
              <DecisionScale key={d} decision={d} />
            ))}
          </div>
        </Row>
        <Row label="큰 크기(분석 결과 머리)">
          <div className={styles.inline}>
            <DecisionScale decision="Overweight" size="lg" />
            <DecisionScale decision="Hold" size="lg" />
            <DecisionScale decision="Sell" size="lg" />
            <DecisionScale decision="REVIEW" size="lg" />
          </div>
        </Row>
      </div>
    </Section>
  );
}

/* ---------- 수신 상태와 시장 상태 ---------- */

function States() {
  return (
    <Section title="수신 상태와 시장 상태" meta="점 모양과 글자로 말한다. 빨강·파랑은 쓰지 않는다">
      <div className={styles.rows}>
        <Row label="FeedStatus">
          <div className={styles.inline}>
            <FeedStatus state="live" />
            <FeedStatus state="polling" intervalSeconds={30} />
            <FeedStatus state="disconnected" />
            <FeedStatus state="closed" />
            <FeedStatus state="idle" />
          </div>
        </Row>
        <Row label="MarketState 칩">
          <div className={styles.inline}>
            <MarketState market="KR" status="open" detail="15:30 마감" />
            <MarketState market="US" status="closed" detail="23:30 개장" />
            <MarketState market="KR" status="holiday" detail="11/4(수) 09:00 개장" />
          </div>
        </Row>
      </div>
    </Section>
  );
}

/* ---------- 버튼 ---------- */

function Buttons() {
  return (
    <Section title="버튼" meta="주 버튼은 한 화면에 하나. 주문처럼 읽히는 버튼은 만들지 않는다">
      <div className={styles.rows}>
        <Row label="주 · 보조 · 조용한">
          <div className={styles.inline}>
            <Button variant="primary">새 분석</Button>
            <Button>진행 보기</Button>
            <Button variant="quiet">전체 보기</Button>
          </div>
        </Row>
        <Row label="아이콘과 함께, 작은 크기">
          <div className={styles.inline}>
            <Button icon={<Icon name="pause" size="sm" />}>감시 일시 중지</Button>
            <Button icon={<Icon name="play" size="sm" />}>감시 다시 시작</Button>
            <Button size="sm" icon={<Icon name="refresh" size="sm" />}>
              지금 다시 확인
            </Button>
            <Button size="sm" variant="primary">
              연결 테스트
            </Button>
          </div>
        </Row>
        <Row label="누를 수 없음 · 진행 중">
          <div className={styles.inline}>
            <Button variant="primary" disabled>
              새 분석
            </Button>
            <Button disabled>진행 보기</Button>
            <Button variant="quiet" disabled>
              분석 취소
            </Button>
            <Button busy>확인 중…</Button>
          </div>
        </Row>
      </div>
    </Section>
  );
}

/* ---------- 탭 ---------- */

const AGENT_TABS: [string, string, string][] = [
  ['summary', '요약', '세 줄 요약과 결정 근거를 먼저 보여 줍니다.'],
  ['market', '시장', '최근 20거래일 거래량이 평균보다 많았고 이동평균선 위에서 움직였습니다.'],
  ['news', '뉴스', '메모리 가격 반등 기사가 늘었고, 환율 관련 우려가 함께 나왔습니다.'],
  ['fundamentals', '재무', '영업이익률이 두 분기 연속 개선되었습니다.'],
  ['debate', '강세·약세 토론', '강세 측은 업황 회복을, 약세 측은 재고 부담을 근거로 들었습니다.'],
  ['risk', '리스크', '환율이 크게 움직이면 결론을 다시 봐야 한다고 정리했습니다.'],
];

const kospiCloses = indices[0]?.closes ?? [];
const dayLabels = kospiCloses.map((_, i) => `D-${kospiCloses.length - 1 - i}`);
const fmt2 = (n: number) => formatNumber(n, 2);

function Charts() {
  return (
    <Section title="차트" meta="직접 그린 SVG. 방향 색은 옆 숫자와 같은 자료, 축 눈금 12px">
      <div className={styles.rows}>
        <Row label="LineChart: 영역 + 선, 전일 종가 점선, 마지막 값 표지">
          <div className={styles.chartBox}>
            <LineChart
              values={kospiCloses}
              labels={dayLabels}
              baseline={kospiCloses[kospiCloses.length - 2]}
              direction="up"
              format={fmt2}
              aria-label="코스피 최근 30거래일 종가"
            />
          </div>
        </Row>
        <Row label="빈 자료 · 값 1개 · 모두 같음 · null 섞임">
          <div className={styles.chartEdges}>
            <LineChart
              values={[]}
              direction="flat"
              format={fmt2}
              height={96}
              aria-label="자료 없음 견본"
            />
            <LineChart
              values={[742.15]}
              direction="down"
              format={fmt2}
              height={96}
              aria-label="값 1개 견본"
            />
            <LineChart
              values={[100, 100, 100, 100]}
              direction="flat"
              format={fmt2}
              height={96}
              aria-label="보합 견본"
            />
            <LineChart
              values={[5, 6, null, 7, 8, null, 6, 9]}
              direction="up"
              format={fmt2}
              height={96}
              aria-label="끊긴 선 견본"
            />
          </div>
        </Row>
        <Row label="DivergingBar: 수급(순매수 오른쪽 빨강, 순매도 왼쪽 파랑, 0은 막대 없음)">
          <div className={styles.barBox}>
            <DivergingBar
              aria-label="코스피 투자자별 순매수"
              format={formatEokChange}
              rows={[
                { label: '외국인', value: flows.foreign },
                { label: '기관', value: flows.institution },
                { label: '개인', value: flows.individual },
                { label: '기타', value: 0 },
              ]}
            />
          </div>
        </Row>
        <Row label="억 금액(부호 없음)">
          <p className="vt-num">
            거래대금 {formatEok(9_812_300_000_000)} · 시가총액 {formatEok(426_000_000_000_000)}
          </p>
        </Row>
      </div>
    </Section>
  );
}

function InputsDemo() {
  const [market, setMarket] = useState<'all' | 'kr' | 'us' | 'jp'>('kr');
  const [range, setRange] = useState<'1d' | '5d' | '1m' | '1y'>('1d');
  const [kpiRow, setKpiRow] = useState(true);
  const [name, setName] = useState('국내 장중');
  const [dialog, setDialog] = useState(false);
  return (
    <Section
      title="입력과 메뉴"
      meta="키보드만으로 열기·이동·선택·Esc. 막힌 항목은 숨기지 않고 이유를 보인다"
    >
      <div className={styles.rows}>
        <Row label="Select: 막힌 항목은 건너뛰고 이유를 보인다">
          <Select
            label="시장"
            value={market}
            onChange={setMarket}
            options={[
              { value: 'all', label: '전체' },
              { value: 'kr', label: '국내 전체' },
              { value: 'jp', label: '일본', disabled: true, reason: '이 버전에서 지원하지 않음' },
              { value: 'us', label: '미국' },
            ]}
          />
        </Row>
        <Row label="Menu: 칸 머리의 ⋯">
          <Menu
            align="start"
            trigger={<Button variant="icon" aria-label="칸 메뉴" icon={<Icon name="more" />} />}
            items={[
              { id: 'change', label: '내용 바꾸기', onSelect: () => undefined },
              { id: 'refresh', label: '새로 고침', onSelect: () => undefined },
              {
                id: 'remove',
                label: '칸 지우기',
                onSelect: () => undefined,
                disabled: true,
                reason: '칸이 하나뿐이라 지울 수 없음',
              },
            ]}
          />
        </Row>
        <Row label="SegmentedControl: ←→로 바로 선택">
          <SegmentedControl
            label="기간"
            value={range}
            onChange={setRange}
            options={[
              { value: '1d', label: '1일' },
              { value: '5d', label: '5일' },
              { value: '1m', label: '1개월', disabled: true },
              { value: '1y', label: '1년' },
            ]}
          />
        </Row>
        <Row label="Toggle: Space·Enter">
          <div className={styles.toggles}>
            <Toggle label="맨 위 숫자 줄 보이기" checked={kpiRow} onChange={setKpiRow} />
            <Toggle label="막힌 스위치" checked={false} onChange={() => undefined} disabled />
          </div>
        </Row>
        <Row label="TextField: 도움말 · 글자 수 · 오류(황토)">
          <div className={styles.fields}>
            <TextField
              label="탭 이름"
              value={name}
              onChange={setName}
              hint="1~20자"
              maxLength={20}
            />
            <TextField
              label="탭 이름"
              value=""
              onChange={() => undefined}
              error="이름을 1자 이상 쓰세요."
            />
          </div>
        </Row>
        <Row label="ProgressBar">
          <div className={styles.progressDemo}>
            <ProgressBar value={60} label="분석 진행 60%" />
          </div>
        </Row>
        <Row label="Dialog: 초점 가둠, Esc, 닫히면 연 버튼으로">
          <Button onClick={() => setDialog(true)}>탭 삭제…</Button>
          <Dialog
            open={dialog}
            title="‘미국’ 탭을 삭제할까요?"
            onClose={() => setDialog(false)}
            footer={
              <>
                <Button onClick={() => setDialog(false)}>취소</Button>
                <Button variant="primary" onClick={() => setDialog(false)}>
                  삭제
                </Button>
              </>
            }
          >
            탭 안의 칸 배치도 함께 사라집니다. 마지막 남은 탭은 삭제할 수 없습니다.
          </Dialog>
        </Row>
      </div>
    </Section>
  );
}

function TabsDemo() {
  return (
    <Section title="탭" meta="←→ 이동과 동시에 선택, Home·End">
      <div className={styles.rows}>
        <Row label="line: 본문 탭">
          <Tabs defaultValue="summary">
            <TabList label="에이전트별 보고서">
              {AGENT_TABS.map(([value, label]) => (
                <Tab key={value} value={value}>
                  {label}
                </Tab>
              ))}
            </TabList>
            {AGENT_TABS.map(([value, , text]) => (
              <TabPanel key={value} value={value}>
                <AiText>{text}</AiText>
              </TabPanel>
            ))}
          </Tabs>
        </Row>
        <Row label="segment: 작은 전환">
          <div className={styles.stack}>
            <Tabs defaultValue="kr">
              <TabList label="시장" variant="segment">
                <Tab value="kr">국내</Tab>
                <Tab value="us">미국</Tab>
              </TabList>
              <TabPanel value="kr">
                <AiText>{brief.lead}</AiText>
              </TabPanel>
              <TabPanel value="us">
                <AiText>{brief.usLead}</AiText>
              </TabPanel>
            </Tabs>
          </div>
        </Row>
      </div>
    </Section>
  );
}

/* ---------- 구역과 표 ---------- */

function SectionsAndTables() {
  const [opened, setOpened] = useState('');
  return (
    <Section
      title="구역과 표"
      meta="칸 카드 안의 묶음은 선으로(카드 안 카드 금지). 짙은 머리줄, 숫자 열은 오른쪽 정렬"
    >
      <div className={styles.twoUp}>
        <div className={styles.twoUpGrid}>
          <Section
            headingLevel={3}
            title="감시 종목"
            meta="5종목 · 예시 데이터"
            actions={<Button variant="quiet">종목 추가</Button>}
          >
            <WatchTable onOpen={(row) => setOpened(row.name)} />
            <p className={styles.activity} aria-live="polite">
              {opened ? `열기: ${opened}` : '행을 누르거나 Tab으로 들어가 ↑↓, Enter로 엽니다.'}
            </p>
          </Section>
          <Section headingLevel={3} title="알림 규칙" meta="0개">
            <DataTable
              caption="알림 규칙"
              columns={[
                { key: 'kind', header: '종류', cell: () => null },
                { key: 'value', header: '기준', numeric: true, cell: () => null },
              ]}
              rows={[]}
              rowKey={() => ''}
              empty="아직 규칙이 없습니다. 감시 종목에서 규칙 추가를 누르세요."
            />
          </Section>
        </div>
      </div>
    </Section>
  );
}

/* ---------- 미니 차트 ---------- */

function Sparklines() {
  return (
    <Section title="미니 차트" meta="선 하나와 끝점. 색은 그날 전일 대비 방향">
      <div className={styles.rows}>
        <Row label="지수 표 안(예시 데이터)">
          <IndexTable />
          <FlowsLine />
        </Row>
        <Row label="상승 · 하락 · 보합 · 한 점 · 없음 (direction을 줌)">
          <div className={styles.inline}>
            <Sparkline values={[3, 4, 3.5, 5, 6]} label="상승 예" direction="up" />
            <Sparkline values={[6, 5, 5.5, 4, 3]} label="하락 예" direction="down" />
            <Sparkline values={[5, 5, 5, 5]} label="보합 예" direction="flat" />
            <Sparkline values={[5]} label="한 점 예" />
            <Sparkline values={[]} label="빈 예" />
          </div>
        </Row>
      </div>
    </Section>
  );
}

/* ---------- 배너와 면책 문구 ---------- */

function Notices() {
  return (
    <Section
      title="배너와 면책 문구"
      meta="오류·오프라인도 빨강이 아닌 황토. 원인과 해결 방법을 함께"
    >
      <div className={styles.rows}>
        <Row label="주의: 오프라인">
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
        </Row>
        <Row label="주의: 오류(키)">
          <Banner
            tone="caution"
            title="한투 키를 확인하세요"
            action={<Button size="sm">설정 열기</Button>}
          >
            키가 틀렸거나 만료되었습니다. 시세와 알림이 멈췄습니다.
          </Banner>
        </Row>
        <Row label="안내">
          <Banner tone="info" title="Vater는 트레이에서 계속 실행됩니다">
            창을 닫아도 알림 감시는 계속됩니다.
          </Banner>
        </Row>
        <Row label="면책 문구">
          <div className={styles.stack}>
            <Disclaimer />
            <Disclaimer analysis />
            <Disclaimer>Vater는 주문 기능이 없습니다.</Disclaimer>
          </div>
        </Row>
      </div>
    </Section>
  );
}

/* ---------- AI 문장 ---------- */

function AiProse() {
  return (
    <Section title="AI 문장" meta="왼쪽 옅은 강조선과 꼬리표로 데이터와 구분한다">
      <div className={styles.rows}>
        <Row label="브리핑: 첫 문장 + 이어지는 문장">
          <div className={styles.stack}>
            <AiText size="lead">{brief.lead}</AiText>
            <AiText attribution="AI 해석">{brief.more}</AiText>
            <FlowsLine />
          </div>
        </Row>
        <Row label="분석 결과 머리(예시)">
          <div className={styles.summary}>
            <div className={styles.summaryHead}>
              <DecisionScale decision="Overweight" size="lg" />
              <span className={styles.small}>삼성전자 · 기준일 11월 2일 · 클라우드 전용</span>
            </div>
            <AiText as="div" attribution="AI 요약">
              <ol className={styles.summaryList}>
                {analysisSummary.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ol>
            </AiText>
            <Disclaimer analysis />
          </div>
        </Row>
      </div>
    </Section>
  );
}

/* ---------- 사이드바와 상태 표시줄 ---------- */

function Chrome() {
  return (
    <Section
      title="사이드바와 상태 표시줄"
      meta="흰 바탕, 현재 화면만 강조색"
      actions={
        <a className={styles.inlineLink} href="#shell">
          창 틀 전체 보기
        </a>
      }
    >
      <div className={styles.frame}>
        <SidebarNav
          items={navItems}
          currentId="alerts"
          onNavigate={() => undefined}
          footer={<SidebarFoot />}
        />
        <div className={styles.frameBody}>본문 자리</div>
      </div>
      <div className={styles.statusFrame}>
        <StatusBarSample />
      </div>
      <div className={styles.statusFrame}>
        <StatusBarSample offline />
      </div>
    </Section>
  );
}

/** 컴포넌트 견본(gallery.html). 예시 데이터로 실제 상태를 늘어놓는다. */
export function Gallery() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Vater 디자인 시스템</h1>
          <p className={styles.lede}>대시보드 라이트. 시세, 문장, 알림은 모두 예시 데이터입니다.</p>
        </div>
        <nav className={styles.links} aria-label="견본 보기">
          <a href="#dashboard">대시보드 견본</a>
          <a href="#shell">창 틀 견본</a>
          <a href="#shell-offline">오프라인 창 틀</a>
        </nav>
      </header>
      <Colors />
      <Typography />
      <SpacingAndRules />
      <Numbers />
      <Decisions />
      <States />
      <Buttons />
      <TabsDemo />
      <InputsDemo />
      <SectionsAndTables />
      <Sparklines />
      <Charts />
      <Notices />
      <AiProse />
      <Chrome />
    </div>
  );
}
