import type { AnalysisDetail } from '../../api/types';
import {
  AiText,
  Card,
  DataTable,
  DecisionScale,
  Disclaimer,
  formatNumber,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  type Column,
} from '../../design-system';
import { PRESET_LABEL } from '../../app/status';
import common from '../common/screen.module.css';
import { formatDuration } from '../common/time';
import styles from './analysis.module.css';
import { toDecision } from './decision';
import { STAGES } from './stages';

/** 보고서 탭(이 순서). 애널리스트 보고서는 영어일 수 있다(스펙 5장 한국어). */
const REPORTS: { key: string; label: string; analyst: boolean }[] = [
  { key: 'market_report', label: '시장 분석', analyst: true },
  { key: 'sentiment_report', label: '소셜 분석', analyst: true },
  { key: 'news_report', label: '뉴스 분석', analyst: true },
  { key: 'fundamentals_report', label: '재무 분석', analyst: true },
  { key: 'investment_plan', label: '리서치 매니저', analyst: false },
  { key: 'trader_investment_plan', label: '트레이더', analyst: false },
  { key: 'final_trade_decision', label: '포트폴리오 매니저', analyst: false },
];

interface StageRow {
  id: string;
  label: string;
  seconds: number | undefined;
}

const stageColumns: Column<StageRow>[] = [
  { key: 'label', header: '단계', cell: (r) => r.label },
  {
    key: 'time',
    header: '시간',
    numeric: true,
    cell: (r) => (typeof r.seconds === 'number' ? formatDuration(r.seconds) : '—'),
  },
];

function Opinion({ detail }: { detail: AnalysisDetail }) {
  const target = [
    detail.price_target ? `목표가 ${detail.price_target}` : null,
    detail.time_horizon ? `기간 ${detail.time_horizon}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const lines = detail.summary ?? [];
  return (
    <Card title="AI 의견">
      <div className={styles.opinion}>
        <DecisionScale decision={toDecision(detail.decision)} size="lg" />
        {detail.decision_changed ? (
          <p className={common.meta}>
            직전 분석과 결정이 달라졌습니다. 분석 이력에서 비교해 보세요.
          </p>
        ) : null}
        {lines.length > 0 ? (
          <AiText as="div" attribution="AI 요약">
            <ol className={styles.summaryList} aria-label="핵심 근거">
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          </AiText>
        ) : (
          <p className={common.empty}>
            AI가 요약을 내지 않았습니다. 아래 보고서 원문을 확인하세요.
          </p>
        )}
        {target ? (
          // 목표가·기간은 데이터가 아니라 AI가 쓴 말이다(명조)
          <AiText attribution="AI 제시">
            <span>{target}</span>
          </AiText>
        ) : null}
        <Disclaimer analysis />
      </div>
    </Card>
  );
}

function Reports({ reports }: { reports: Record<string, string> | null }) {
  const available = REPORTS.filter((r) => (reports?.[r.key] ?? '').trim() !== '');
  const first = available[0];
  if (!first) {
    return (
      <Card title="에이전트 보고서">
        <p className={common.empty}>보고서가 없습니다.</p>
      </Card>
    );
  }
  return (
    <Tabs defaultValue={first.key}>
      <Card title="에이전트 보고서">
        <TabList label="에이전트">
          {available.map((r) => (
            <Tab key={r.key} value={r.key}>
              {r.label}
            </Tab>
          ))}
        </TabList>
        {available.map((r) => (
          <TabPanel key={r.key} value={r.key}>
            <div className={styles.reportPanel}>
              {r.analyst ? <span className={common.meta}>원문(영어일 수 있음)</span> : null}
              <AiText attribution="AI 보고서" className={styles.report}>
                {reports?.[r.key]}
              </AiText>
            </div>
          </TabPanel>
        ))}
      </Card>
    </Tabs>
  );
}

function RunInfo({ detail }: { detail: AnalysisDetail }) {
  const timings = detail.timings ?? {};
  const total = Object.values(timings).reduce((sum, s) => sum + s, 0);
  const rows: StageRow[] = STAGES.map((s) => ({
    id: s.id,
    label: s.label,
    seconds: timings[s.id],
  }));
  const model = (tier: string) => {
    const m = detail.models?.[tier];
    return m ? `${m.provider} · ${m.model}` : '—';
  };
  const tokens = detail.tokens;
  return (
    <Card title="실행 정보">
      <dl className={styles.facts}>
        <dt>AI 사용 방식</dt>
        <dd>{PRESET_LABEL[detail.preset] ?? detail.preset}</dd>
        <dt>결론을 내는 모델</dt>
        <dd>{model('deep')}</dd>
        <dt>자료를 정리하는 모델</dt>
        <dd>{model('quick')}</dd>
        <dt>걸린 시간</dt>
        <dd className="vt-num">{detail.timings ? formatDuration(total) : '—'}</dd>
        <dt>AI 사용량</dt>
        <dd className="vt-num">
          {tokens
            ? `입력 ${formatNumber(tokens.in ?? null)} · 출력 ${formatNumber(tokens.out ?? null)}`
            : '—'}
        </dd>
      </dl>
      <DataTable caption="단계별 시간" columns={stageColumns} rows={rows} rowKey={(r) => r.id} />
    </Card>
  );
}

/** 분석 결과(스펙 5장): 의견 눈금, 3줄 요약, 목표가·기간, 면책, 에이전트별 보고서, 실행 정보. */
export function AnalysisResult({ detail }: { detail: AnalysisDetail }) {
  return (
    <div className={common.twoUp}>
      <div className={common.twoUpGrid}>
        <div className={common.column}>
          <Opinion detail={detail} />
          <Reports reports={detail.reports} />
        </div>
        <div className={common.column}>
          <RunInfo detail={detail} />
        </div>
      </div>
    </div>
  );
}
