import type { BriefingDetail, MarketCode } from '../../api/types';
import { AiText, Disclaimer, DivergingBar, formatEokChange } from '../../design-system';
import { missingLabel, parseFlows, parseIndices } from '../../screens/briefing/data';
import { IndexTable } from '../../screens/briefing/tables';
import { formatDay, formatHm } from '../../screens/common/time';
import { useShared } from '../shared';
import { briefingSource, settingsSource } from '../sources';
import { PanelEmpty, PanelError, styles } from './common';
import { pick, type PanelProps } from './types';

export const BRIEF_MARKETS = ['KR', 'US'] as const;
export const MARKET_NAME: Record<MarketCode, string> = { KR: '국내', US: '미국' };

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
      <PanelEmpty>
        {`${MARKET_NAME[market]} 브리핑이 꺼져 있습니다 · `}
        <a href="#/settings">설정 열기</a>
      </PanelEmpty>
    );
  }
  const time = settings?.[`briefing.${key}.time`];
  const at = typeof time === 'string' ? time : market === 'KR' ? '16:00' : '07:00';
  return (
    <PanelEmpty>
      {`아직 ${MARKET_NAME[market]} 브리핑이 없습니다. 거래일마다 ${at}에 자동으로 만들어집니다.`}
    </PanelEmpty>
  );
}

/** 칸 머리 설명: "11월 2일(월) 국내 마감 · 16:00 생성". */
export function briefingMeta(detail: BriefingDetail, market: MarketCode): string {
  return `${formatDay(detail.date)} ${MARKET_NAME[market]} 마감 · ${formatHm(detail.created_at)} 생성`;
}

function Body({ detail, market }: { detail: BriefingDetail; market: MarketCode }) {
  const flow = parseFlows(detail.data)[0];
  const indices = parseIndices(detail.data);
  // AI 해석이 빠진 것은 "AI 해석 없음(데이터만)"이 이미 말한다
  const missing = detail.missing.filter((m) => m !== 'interpretation');
  return (
    <div className={styles.body}>
      <span className={styles.itemMeta}>{briefingMeta(detail, market)}</span>
      {detail.headline ? (
        <AiText size="lead" attribution="AI 해석">
          {detail.headline}
        </AiText>
      ) : (
        <p className={styles.itemMeta}>AI 해석 없음(데이터만)</p>
      )}
      {market === 'KR' && flow ? (
        <DivergingBar
          aria-label={`투자자별 순매수 · ${flow.label}`}
          format={formatEokChange}
          rows={[
            { label: '외국인', value: flow.foreign ?? 0 },
            { label: '기관', value: flow.institution ?? 0 },
            { label: '개인', value: flow.individual ?? 0 },
          ]}
        />
      ) : indices.length > 0 ? (
        <IndexTable rows={indices} />
      ) : null}
      {missing.length > 0 ? (
        <span
          className={styles.itemMeta}
        >{`빠진 항목: ${missing.map(missingLabel).join(', ')}`}</span>
      ) : null}
      <div className={styles.foot}>
        <Disclaimer />
        <a href={`#/briefings/${detail.id}`}>브리핑 읽기 ›</a>
      </div>
    </div>
  );
}

/** 브리핑 요약: 최신 브리핑의 AI 한 줄, 수급(국내) 또는 지수(미국), 면책. */
export function BriefingPanel({ options }: PanelProps) {
  const market = pick(options, 'market', BRIEF_MARKETS, 'KR');
  const latest = useShared(briefingSource(market));
  const settings = useShared(settingsSource);
  if (latest.error) {
    return (
      <PanelError
        error={latest.error}
        title="브리핑을 불러오지 못했습니다"
        onRetry={latest.reload}
      />
    );
  }
  if (latest.data === undefined) return <div className={styles.body} aria-busy="true" />;
  if (latest.data === null) return <EmptyBriefing market={market} settings={settings.data} />;
  return <Body detail={latest.data} market={market} />;
}
