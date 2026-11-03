import { useState } from 'react';
import { useResource } from '../../api/useResource';
import type { BriefingDetail, BriefingItem, MarketCode } from '../../api/types';
import {
  AiText,
  DataTable,
  directionOf,
  formatNumber,
  Section,
  SignedNumber,
  Sparkline,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  type Column,
} from '../../design-system';
import { missingLabel, parseIndices, type IndexRow } from '../briefing/data';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import { MissingValue } from '../common/quotes';
import common from '../common/screen.module.css';
import { formatDay, formatHm } from '../common/time';
import styles from './home.module.css';

const MARKET_NAME: Record<MarketCode, string> = { KR: '국내', US: '미국' };

const indexColumns: Column<IndexRow>[] = [
  { key: 'name', header: '지수', cell: (r) => <b>{r.name}</b> },
  {
    key: 'value',
    header: '종가',
    numeric: true,
    cell: (r) => (r.value === null ? <MissingValue /> : formatNumber(r.value, 2)),
  },
  {
    key: 'change',
    header: '전일 대비',
    numeric: true,
    cell: (r) => <SignedNumber value={r.change} format="number" decimals={2} />,
  },
  {
    key: 'pct',
    header: '등락률',
    numeric: true,
    cell: (r) => <SignedNumber value={r.changePct} format="percent" />,
  },
  {
    key: 'spark',
    header: <span className={common.afterNumeric}>최근 30일</span>,
    width: '7rem',
    cell: (r) => (
      <span className={common.afterNumeric}>
        {/* 선 색은 옆 숫자와 같은 자료: 그날 전일 대비 방향 */}
        <Sparkline
          values={r.closes}
          label={`${r.name} 최근 30일 종가`}
          direction={directionOf(r.change)}
        />
      </span>
    ),
  },
];

function useLatestBriefing(market: MarketCode) {
  return useResource<BriefingDetail | null>(
    `home:briefing:${market}`,
    async (api) => {
      const list = await api.request<BriefingItem[]>('/briefings', { query: { market, limit: 1 } });
      const first = list[0];
      return first ? api.request<BriefingDetail>(`/briefings/${first.id}`) : null;
    },
    { refreshOn: ['briefing.status'] },
  );
}

function EmptyBriefing({
  market,
  settings,
}: {
  market: MarketCode;
  settings?: Record<string, unknown>;
}) {
  const key = market === 'KR' ? 'kr' : 'us';
  if (settings?.[`briefing.${key}.enabled`] === false) {
    return (
      <p className={common.empty}>
        {`${MARKET_NAME[market]} 브리핑이 꺼져 있습니다.`}
        <a className={common.textLink} href="#/settings">
          설정 열기
        </a>
      </p>
    );
  }
  const time = settings?.[`briefing.${key}.time`];
  const at = typeof time === 'string' ? time : market === 'KR' ? '16:00' : '07:00';
  return (
    <p className={common.empty}>
      {`아직 ${MARKET_NAME[market]} 브리핑이 없습니다. 거래일마다 ${at}에 자동으로 만들어집니다.`}
    </p>
  );
}

function BriefingBody({ detail }: { detail: BriefingDetail }) {
  const rows = parseIndices(detail.data);
  return (
    <div className={styles.brief}>
      {detail.headline ? (
        <AiText size="lead" attribution="AI 해석">
          {detail.headline}
        </AiText>
      ) : (
        <p className={common.meta}>AI 해석 없음(데이터만)</p>
      )}
      {rows.length > 0 ? (
        <DataTable
          caption="지수"
          columns={indexColumns}
          rows={rows}
          rowKey={(r) => r.code || r.name}
        />
      ) : null}
      <div className={styles.briefFoot}>
        {detail.missing.length > 0 ? (
          <span className={common.meta}>
            {`빠진 항목: ${detail.missing.map(missingLabel).join(', ')}`}
          </span>
        ) : (
          <span />
        )}
        <a className={common.textLink} href={`#/briefings/${detail.id}`}>
          브리핑 읽기
        </a>
      </div>
    </div>
  );
}

/** 최근 브리핑: 국내·미국 탭, AI 한 줄 요약, 지수 표와 미니 차트. 숫자는 수집 자료에서만(D9). */
export function BriefingCard({ settings }: { settings?: Record<string, unknown> }) {
  const [market, setMarket] = useState<MarketCode>('KR');
  const latest = useLatestBriefing(market);
  const detail = latest.data;
  const meta = detail
    ? `${formatDay(detail.date)} ${MARKET_NAME[market]} 마감 · ${formatHm(detail.created_at)}`
    : undefined;

  let body = null;
  if (latest.error) {
    body = (
      <ApiErrorNotice
        error={latest.error}
        title="브리핑을 불러오지 못했습니다"
        onRetry={latest.reload}
      />
    );
  } else if (detail === null) {
    body = <EmptyBriefing market={market} settings={settings} />;
  } else if (detail) {
    body = <BriefingBody detail={detail} />;
  }

  return (
    <Tabs value={market} onValueChange={(v) => setMarket(v === 'US' ? 'US' : 'KR')}>
      <Section
        title="최근 브리핑"
        meta={meta}
        actions={
          <TabList label="시장" variant="segment">
            <Tab value="KR">국내</Tab>
            <Tab value="US">미국</Tab>
          </TabList>
        }
      >
        <TabPanel value="KR">{market === 'KR' ? body : null}</TabPanel>
        <TabPanel value="US">{market === 'US' ? body : null}</TabPanel>
      </Section>
    </Tabs>
  );
}
