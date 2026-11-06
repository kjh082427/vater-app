import type { ReactNode } from 'react';
import { useEvent } from '../../api/services';
import { useResource } from '../../api/useResource';
import type { BriefingDetail, MyAssets } from '../../api/types';
import {
  AiText,
  Card,
  Disclaimer,
  formatNumber,
  Section,
  SignedNumber,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from '../../design-system';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import { marketLabel } from '../common/quotes';
import { ScreenHeader } from '../common/ScreenHeader';
import { InterpretRetry } from './InterpretRetry';
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

const CURRENCY_NAME: Record<string, string> = { KRW: '원화', USD: '달러' };

/**
 * 내 자산(스펙 15장): 오늘 평가금액 변화와 가장 많이 기여한·빠진 종목. 앱이 보유 내역으로 직접 계산한 값이라
 * AI를 거치지 않고(꼬리표 없음), AI 입력에도 들어가지 않는다. 일부 종목의 종가가 없으면 그 통화는 더하지 않는다.
 */
function MyAssetsSection({ assets }: { assets: MyAssets }) {
  const move = (m: MyAssets['top'], word: string) => (
    <div>
      <dt>{word}</dt>
      <dd>
        {m ? (
          <>
            <b>{m.name}</b>{' '}
            <SignedNumber value={m.amount} format={m.currency === 'USD' ? 'usd' : 'won'} unit />
          </>
        ) : (
          <span className={common.meta}>해당 없음</span>
        )}
      </dd>
    </div>
  );
  return (
    <Card title="내 자산" description="오늘 평가금액 변화(전일 종가 대비)">
      <div className={styles.body}>
        <dl className={styles.assets}>
          <div>
            <dt>전체(원화 환산)</dt>
            <dd>
              <SignedNumber value={assets.change_krw} format="won" unit />{' '}
              <SignedNumber value={assets.change_pct} format="percent" />
            </dd>
          </div>
          {Object.entries(assets.currencies).map(([cur, c]) => (
            <div key={cur}>
              <dt>{CURRENCY_NAME[cur] ?? cur}</dt>
              <dd>
                <SignedNumber value={c.change} format={cur === 'USD' ? 'usd' : 'won'} unit />{' '}
                <SignedNumber value={c.change_pct} format="percent" />
              </dd>
            </div>
          ))}
          {move(assets.top, '가장 많이 기여')}
          {move(assets.bottom, '가장 많이 빠짐')}
        </dl>
        {assets.change_krw === null ? (
          <p className={styles.missing}>
            전일 기록이나 종가·환율이 없어 변화를 계산하지 못했습니다. 일부 종목의 종가가 없으면 그
            통화는 더하지 않습니다.
          </p>
        ) : null}
        <p className={common.meta}>앱이 계산한 값입니다. AI를 거치지 않습니다.</p>
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
          <>
            <p className={common.meta}>AI 해석 없음(데이터만)</p>
            <InterpretRetry b={b} />
          </>
        )}
        {missing.length > 0 ? (
          <p className={styles.missing}>{`빠진 항목: ${missing.map(missingLabel).join(', ')}`}</p>
        ) : null}
      </div>
      <div className={common.twoUp}>
        <div className={common.twoUpGrid}>
          <div className={common.column}>
            {b.my_assets ? <MyAssetsSection assets={b.my_assets} /> : null}
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
  const b = detail.data;
  useEvent('briefing.status', (event) => {
    // 같은 날·시장의 브리핑이면 id가 없는 소식(만드는 중)도 해석 상태를 바꿀 수 있다
    if (event.id === id || (b && event.market === b.market && event.date === b.date)) reload();
  });
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
