import { useState } from 'react';
import { toApiError, type ApiError } from '../../api/errors';
import { useApi, useEvent } from '../../api/services';
import { useResource } from '../../api/useResource';
import type { BriefingItem, EventMap, MarketCode } from '../../api/types';
import { AiText, Banner, Button, Section, Tab, TabList, TabPanel, Tabs } from '../../design-system';
import { hrefOf } from '../../app/router';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import { marketLabel } from '../common/quotes';
import { ScreenHeader } from '../common/ScreenHeader';
import common from '../common/screen.module.css';
import { formatDay } from '../common/time';
import styles from './briefing.module.css';
import { missingLabel } from './data';

type Filter = 'all' | MarketCode;
type RunState = EventMap['briefing.status'];

const LIMIT = 30;

function setting(settings: Record<string, unknown> | undefined, key: string, fallback: string) {
  const v = settings?.[key];
  return typeof v === 'string' ? v : fallback;
}

function BriefingList({
  filter,
  settings,
}: {
  filter: Filter;
  settings?: Record<string, unknown>;
}) {
  const list = useResource<BriefingItem[]>(
    `/briefings?market=${filter}`,
    (api) =>
      api.request<BriefingItem[]>('/briefings', {
        query: { market: filter === 'all' ? undefined : filter, limit: LIMIT },
      }),
    { refreshOn: ['briefing.status'] },
  );
  const items = list.data;
  if (list.error) {
    return (
      <ApiErrorNotice
        error={list.error}
        title="브리핑 목록을 불러오지 못했습니다"
        onRetry={list.reload}
      />
    );
  }
  if (!items) return null;
  if (items.length === 0) {
    const kr = setting(settings, 'briefing.kr.time', '16:00');
    const us = setting(settings, 'briefing.us.time', '07:00');
    return (
      <p className={common.empty}>
        {`아직 브리핑이 없습니다. 거래일마다 국내 ${kr}, 미국 ${us}에 자동으로 만들어집니다. 지금 만들기로 바로 만들 수도 있습니다.`}
      </p>
    );
  }
  return (
    <ol className={styles.list} aria-label="브리핑">
      {items.map((b) => {
        const missing = b.missing.filter((m) => m !== 'interpretation');
        return (
          <li key={b.id} className={styles.item}>
            <span className={styles.itemHead}>
              <a className={styles.itemLink} href={hrefOf({ name: 'briefing', id: b.id })}>
                {`${formatDay(b.date)} ${marketLabel(b.market)}`}
              </a>
              {missing.length > 0 ? (
                <span
                  className={styles.missing}
                >{`빠진 항목: ${missing.map(missingLabel).join(', ')}`}</span>
              ) : null}
            </span>
            {b.headline ? (
              <AiText attribution="AI 해석">{b.headline}</AiText>
            ) : (
              <span className={common.meta}>AI 해석 없음(데이터만)</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function RunBanner({ run }: { run: RunState }) {
  const title = `${marketLabel(run.market)} ${formatDay(run.date)}`;
  if (run.status === 'running') {
    return (
      <Banner tone="info" title={`${title} 브리핑을 만드는 중입니다.`}>
        한국투자증권 자료를 모으고 AI가 해석합니다. 몇 분 걸릴 수 있습니다.
      </Banner>
    );
  }
  if (run.status === 'failed') {
    return (
      <Banner tone="caution" title="브리핑을 만들지 못했습니다">
        {[run.error?.message, run.error?.hint].filter(Boolean).join(' ')}
      </Banner>
    );
  }
  return (
    <Banner
      tone="info"
      title={`${title} 브리핑이 도착했습니다.`}
      action={
        run.id ? (
          <a className={common.textLink} href={hrefOf({ name: 'briefing', id: run.id })}>
            도착한 브리핑 읽기
          </a>
        ) : undefined
      }
    />
  );
}

/** 브리핑 목록(#/briefings): 날짜·시장별, 지금 만들기(202, 진행은 SSE briefing.status). */
export function BriefingsScreen() {
  const api = useApi();
  const settings = useResource<Record<string, unknown>>('/settings');
  const [filter, setFilter] = useState<Filter>('all');
  const [runs, setRuns] = useState<Partial<Record<string, RunState>>>({});
  const [busy, setBusy] = useState<MarketCode | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEvent('briefing.status', (event) => setRuns((prev) => ({ ...prev, [event.market]: event })));

  async function run(market: MarketCode) {
    setBusy(market);
    setError(null);
    try {
      const out = await api.request<{ market: MarketCode; date: string }>('/briefings/run', {
        method: 'POST',
        body: { market },
      });
      setRuns((prev) => ({
        ...prev,
        [out.market]: { market: out.market, date: out.date, status: 'running' },
      }));
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setBusy(null);
    }
  }

  const banners = Object.values(runs).filter((r): r is RunState => Boolean(r));
  return (
    <>
      <ScreenHeader
        title="브리핑"
        lede="장이 끝나면 지수·업종·수급·상위 종목을 모아 AI가 해석합니다. 숫자는 모두 수집 자료에서 나옵니다."
        end={
          <>
            <Button busy={busy === 'KR'} onClick={() => run('KR')}>
              국내 지금 만들기
            </Button>
            <Button busy={busy === 'US'} onClick={() => run('US')}>
              미국 지금 만들기
            </Button>
          </>
        }
      />
      {banners.length > 0 || error ? (
        <div className={styles.banners}>
          {error ? <ApiErrorNotice error={error} /> : null}
          {banners.map((r) => (
            <RunBanner key={r.market} run={r} />
          ))}
        </div>
      ) : null}
      <Tabs value={filter} onValueChange={(v) => setFilter(v === 'KR' || v === 'US' ? v : 'all')}>
        <Section
          title="브리핑 목록"
          actions={
            <TabList label="시장" variant="segment">
              <Tab value="all">전체</Tab>
              <Tab value="KR">국내</Tab>
              <Tab value="US">미국</Tab>
            </TabList>
          }
        >
          {(['all', 'KR', 'US'] as const).map((f) => (
            <TabPanel key={f} value={f}>
              {filter === f ? <BriefingList filter={f} settings={settings.data} /> : null}
            </TabPanel>
          ))}
        </Section>
      </Tabs>
    </>
  );
}
