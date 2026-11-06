import { hrefOf } from '../../app/router';
import { DecisionScale, Disclaimer } from '../../design-system';
import { toDecision } from '../../screens/analysis/decision';
import { marketLabel } from '../../screens/common/quotes';
import { formatDay } from '../../screens/common/time';
import { useShared } from '../shared';
import { analysesSource, analysisSource } from '../sources';
import { PanelEmpty, PanelError, styles } from './common';
import type { Choice, PanelProps } from './types';

/** 고를 수 있는 분석: "가장 최근" + 최근 완료 분석. */
export function useAnalysisChoices(): Choice[] {
  const list = useShared(analysesSource);
  const done = (list.data ?? []).filter((a) => a.status === 'done');
  return [
    { value: 'latest', label: '가장 최근' },
    ...done.map((a) => ({
      value: String(a.id),
      label: `${a.name ?? a.code} · ${formatDay(a.as_of)}`,
    })),
  ];
}

/** 분석 결과: 의견 눈금, 3줄 요약, 목표가, 면책. */
export function AnalysisResultPanel({ options }: PanelProps) {
  const list = useShared(analysesSource);
  const chosen = typeof options.analysis === 'string' ? options.analysis : 'latest';
  const done = (list.data ?? []).filter((a) => a.status === 'done');
  const id =
    chosen === 'latest'
      ? done[0]?.id
      : Number.isInteger(Number(chosen))
        ? Number(chosen)
        : undefined;
  const detail = useShared(id === undefined ? null : analysisSource(id));

  const error = list.error ?? detail.error;
  if (!list.error && detail.error?.status === 404) {
    return <PanelEmpty>지워진 분석입니다 · 칸 설정에서 다른 분석을 고르세요</PanelEmpty>;
  }
  if (error) {
    const retry = () => {
      list.reload();
      detail.reload();
    };
    return <PanelError error={error} title="분석 결과를 불러오지 못했습니다" onRetry={retry} />;
  }
  if (!list.data) return <div className={styles.body} aria-busy="true" />;
  if (id === undefined) {
    return (
      <PanelEmpty>
        아직 끝난 분석이 없습니다 · <a href="#/analyses">새 분석</a>
      </PanelEmpty>
    );
  }
  const d = detail.data;
  if (!d) return <div className={styles.body} aria-busy="true" />;
  return (
    <div className={styles.body}>
      <div className={styles.decision}>
        <span className={styles.itemMeta}>
          {`${marketLabel(d.market)} ${d.name ?? d.code} ${d.code} · 기준일 ${formatDay(d.as_of)}`}
        </span>
        <DecisionScale decision={toDecision(d.decision)} />
      </div>
      {d.summary && d.summary.length > 0 ? (
        <ol className={styles.summary}>
          {d.summary.slice(0, 3).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      ) : null}
      {d.price_target ? (
        <span className={styles.itemMeta}>{`목표가 ${d.price_target}`}</span>
      ) : null}
      <div className={styles.foot}>
        <Disclaimer analysis />
        <a href={hrefOf({ name: 'analysis', id: d.id })}>분석 보기 ›</a>
      </div>
    </div>
  );
}
