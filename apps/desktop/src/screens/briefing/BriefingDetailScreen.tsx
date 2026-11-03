import type { ReactNode } from 'react';
import { useEvent } from '../../api/services';
import { useResource } from '../../api/useResource';
import type { BriefingDetail } from '../../api/types';
import {
  AiText,
  Card,
  Disclaimer,
  formatNumber,
  Section,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from '../../design-system';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import { marketLabel } from '../common/quotes';
import { ScreenHeader } from '../common/ScreenHeader';
import common from '../common/screen.module.css';
import { formatDay, formatDayTime } from '../common/time';
import styles from './briefing.module.css';
import {
  missingLabel,
  parseDayAlerts,
  parseFlows,
  parseIndices,
  parseMovers,
  parseSectors,
  parseWatch,
} from './data';
import { FlowTable, IndexTable, RankTable, SectorTable, WatchTable } from './tables';

/** AI 해석 한 항목. 빈 문장이면 그리지 않는다(데이터가 없는 항목은 AI가 빈 문자열을 준다). */
function Interpretation({ text }: { text: string | undefined }) {
  return text?.trim() ? <AiText attribution="AI 해석">{text}</AiText> : null;
}

function NotReceived({ label }: { label: string }) {
  return <p className={styles.missing}>{`${label} 자료를 받지 못했습니다.`}</p>;
}

function Part({
  title,
  text,
  missing,
  children,
}: {
  title: string;
  text: string | undefined;
  missing: boolean;
  children: ReactNode;
}) {
  return (
    <Card title={title}>
      <div className={styles.body}>
        <Interpretation text={text} />
        {missing ? <NotReceived label={title} /> : children}
      </div>
    </Card>
  );
}

function Movers({ data }: { data: unknown }) {
  const movers = parseMovers(data);
  return (
    <Tabs defaultValue="up">
      <TabList label="상위 종목" variant="segment">
        <Tab value="up">상승률</Tab>
        <Tab value="down">하락률</Tab>
        <Tab value="value">거래대금</Tab>
      </TabList>
      <TabPanel value="up">
        <RankTable caption="상승률 상위" rows={movers.up} />
      </TabPanel>
      <TabPanel value="down">
        <RankTable caption="하락률 상위" rows={movers.down} />
      </TabPanel>
      <TabPanel value="value">
        <RankTable caption="거래대금 상위" rows={movers.value} withValue />
      </TabPanel>
    </Tabs>
  );
}

function Body({ b }: { b: BriefingDetail }) {
  const text = b.text ?? {};
  const has = (key: string) => b.missing.includes(key);
  const domestic = b.market === 'KR';
  const noAi = !b.text || has('interpretation');
  const missing = b.missing.filter((m) => m !== 'interpretation');
  const sectors = parseSectors(b.data);
  const alerts = parseDayAlerts(b.data);
  const lead = text.headline?.trim() ? text.headline : b.headline;

  return (
    <>
      <div className={styles.lead}>
        {!noAi && lead ? (
          <AiText size="lead" attribution="AI 해석">
            {lead}
          </AiText>
        ) : (
          <p className={common.meta}>AI 해석 없음(데이터만)</p>
        )}
        {missing.length > 0 ? (
          <p className={styles.missing}>{`빠진 항목: ${missing.map(missingLabel).join(', ')}`}</p>
        ) : null}
      </div>
      <div className={common.twoUp}>
        <div className={common.twoUpGrid}>
          <div className={common.column}>
            <Part title="지수" text={text.market} missing={has('indices')}>
              <IndexTable rows={parseIndices(b.data)} />
            </Part>
            {domestic ? (
              <Part title="업종" text={text.sectors} missing={has('sectors')}>
                {sectors.map((board) => (
                  <Section key={board.market} title={board.label} headingLevel={3}>
                    <div className={styles.body}>
                      <p className={`${styles.breadth} vt-num`}>
                        {`상승 ${formatNumber(board.advancers)} · 하락 ${formatNumber(board.decliners)} · 보합 ${formatNumber(board.unchanged)}`}
                      </p>
                      <SectorTable caption={`${board.label} 업종`} rows={board.sectors} />
                    </div>
                  </Section>
                ))}
              </Part>
            ) : (
              // 미국은 업종·수급·상위 종목을 모으지 않는다(해당 없음). 눈에 띄는 종목 해석이 있으면 여기에.
              <Interpretation text={text.notable} />
            )}
          </div>
          <div className={common.column}>
            {domestic ? (
              <Part title="수급" text={text.flows} missing={has('flows')}>
                <FlowTable rows={parseFlows(b.data)} />
              </Part>
            ) : null}
            {domestic ? (
              <Part title="상위 종목" text={text.notable} missing={has('movers')}>
                <Movers data={b.data} />
              </Part>
            ) : null}
            <Part title="내 감시 종목" text={text.watchlist} missing={has('watchlist')}>
              <WatchTable rows={parseWatch(b.data)} market={b.market} />
              <Section title="그날 알림" headingLevel={3}>
                {alerts.length === 0 ? (
                  <p className={common.empty}>그날 울린 알림이 없습니다.</p>
                ) : (
                  <ul className={styles.alerts}>
                    {alerts.map((a) => (
                      <li key={`${a.firedAt}:${a.message}`} className={styles.alert}>
                        <span className={`${styles.alertTime} vt-num`}>
                          {formatDayTime(a.firedAt)}
                        </span>
                        <span>{a.message}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </Part>
          </div>
        </div>
      </div>
      <Disclaimer />
    </>
  );
}

/** 머리 보조 정보: AI 해석만 빠졌으면 그렇게, 데이터가 빠졌으면 "일부 항목 빠짐". */
function ledeNote(missing: string[]): string {
  const data = missing.filter((m) => m !== 'interpretation');
  if (data.length > 0) return ' · 일부 항목 빠짐';
  return missing.length > 0 ? ' · AI 해석 없음' : '';
}

/** 브리핑 상세(#/briefings/:id): AI 해석 문장과 데이터 표·미니 차트. 숫자는 표에서만. */
export function BriefingDetailScreen({ id }: { id: number }) {
  const detail = useResource<BriefingDetail>(`/briefings/${id}`);
  const { reload } = detail;
  useEvent('briefing.status', (event) => {
    if (event.id === id) reload();
  });
  const b = detail.data;
  return (
    <>
      <ScreenHeader
        title={b ? `${formatDay(b.date)} ${marketLabel(b.market)} 시장 브리핑` : '브리핑'}
        lede={b ? `${formatDayTime(b.created_at)} 만듦${ledeNote(b.missing)}` : undefined}
        end={
          <a className={common.textLink} href="#/briefings">
            브리핑 목록
          </a>
        }
      />
      {detail.error ? (
        <ApiErrorNotice
          error={detail.error}
          title="브리핑을 불러오지 못했습니다"
          onRetry={reload}
        />
      ) : null}
      {b ? <Body b={b} /> : null}
    </>
  );
}
