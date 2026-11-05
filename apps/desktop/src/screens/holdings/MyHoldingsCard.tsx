import { useState } from 'react';
import { toApiError, type ApiError } from '../../api/errors';
import { useApi } from '../../api/services';
import type { AlertRule, SymbolHoldings, SymbolValue } from '../../api/types';
import {
  BrokerBar,
  BrokerChip,
  Button,
  formatPrice,
  formatQuantity,
  formatShares,
  PriceChange,
  Section,
  Toggle,
} from '../../design-system';
import { ruleSummary } from '../alerts/kinds';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import { currencyOf } from '../common/quotes';
import { formatHm } from '../common/time';
import styles from './holdings.module.css';

const MODE_KEY = 'vater.holdings.chipMode';
type Mode = 'quantity' | 'ratio';

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'ratio' ? 'ratio' : 'quantity';
  } catch {
    return 'quantity'; // 저장소가 막힌 환경에서도 화면은 그려진다
  }
}

export interface MyHoldingsCardProps {
  market: string;
  watchlistId: number;
  holdings: SymbolHoldings;
  value: SymbolValue | undefined;
  /** 시세 시각. */
  at: string | undefined;
  /** 이 종목의 평단가 알림 규칙(없으면 꺼짐). */
  rule: AlertRule | undefined;
  onRulesChanged: () => void;
  onRefreshed: () => void;
}

/** "내 보유" 카드(스펙 4-2, 4-3): 평가금액·손익, 총 수량·평단가, 증권사 막대와 칩, 평단가 알림. */
export function MyHoldingsCard({
  market,
  watchlistId,
  holdings,
  value,
  at,
  rule,
  onRulesChanged,
  onRefreshed,
}: MyHoldingsCardProps) {
  const api = useApi();
  const [mode, setMode] = useState<Mode>(readMode);
  const [busy, setBusy] = useState<'refresh' | 'rule' | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const currency = currencyOf(market);
  const shares = holdings.brokers;
  const percents = formatShares(shares.map((b) => b.ratio));
  const priced = value?.price !== null && value?.price !== undefined;
  const unpriced = Number(holdings.unpriced_quantity);

  function flip() {
    const next: Mode = mode === 'quantity' ? 'ratio' : 'quantity';
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // 기억하지 못해도 이번 화면에서는 바뀐다
    }
  }

  async function run<T>(what: 'refresh' | 'rule', job: () => Promise<T>): Promise<void> {
    setBusy(what);
    setError(null);
    try {
      await job();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setBusy(null);
    }
  }

  const refresh = () =>
    run('refresh', async () => {
      await api.request('/holdings/sync', { method: 'POST', body: {} });
      onRefreshed();
    });

  const toggleRule = (on: boolean) =>
    run('rule', async () => {
      if (on) {
        await api.request('/alerts/rules', {
          method: 'POST',
          body: {
            watchlist_id: watchlistId,
            kind: 'avg_price_pct',
            params: { pct: 10, direction: 'down' },
            enabled: true,
          },
        });
      } else if (rule) {
        await api.request(`/alerts/rules/${rule.id}`, { method: 'DELETE' });
      }
      onRulesChanged();
    });

  return (
    <Section
      title="내 보유"
      headingLevel={3}
      actions={
        <Button size="sm" variant="quiet" busy={busy === 'refresh'} onClick={() => void refresh()}>
          새로 고침
        </Button>
      }
    >
      <div className={styles.holdingsBody}>
        <dl className={styles.figures}>
          <div>
            <dt>평가금액</dt>
            <dd className="vt-num">{priced ? formatPrice(value?.value, currency) : '—'}</dd>
          </div>
          <div>
            <dt>평가손익</dt>
            <dd>
              {priced && value?.pl !== null && value?.pl !== undefined ? (
                <PriceChange change={value.pl} percent={value.pl_pct} currency={currency} unit />
              ) : (
                '—'
              )}
            </dd>
          </div>
        </dl>
        <p className={styles.meta}>
          <span className="vt-num">
            {`총 ${formatQuantity(holdings.total, market)}주 · 평단가 ${holdings.avg_price === null ? '—' : formatPrice(holdings.avg_price, currency)}`}
          </span>
          {priced && at ? <span className="vt-num">{`시세 ${formatHm(at)}`}</span> : null}
        </p>
        {unpriced > 0 ? (
          <p className={styles.meta}>
            {`평단가를 모르는 ${formatQuantity(holdings.unpriced_quantity, market)}주는 손익 계산에서 뺐습니다.`}
          </p>
        ) : null}
        <BrokerBar
          shares={shares.map((b) => ({
            id: b.broker_id,
            name: b.name,
            color: b.color,
            ratio: b.ratio / 100,
          }))}
        />
        <div className={styles.chips}>
          {shares.map((b, i) => (
            <button
              key={b.broker_id}
              type="button"
              className={styles.chipButton}
              title={mode === 'quantity' ? '누르면 비율로 바뀝니다' : '누르면 수량으로 바뀝니다'}
              onClick={flip}
            >
              <BrokerChip id={b.broker_id} color={b.color}>
                {`${b.name} ${mode === 'quantity' ? `${formatQuantity(b.quantity, market)}주` : percents[i]}`}
              </BrokerChip>
              {b.stale ? <span className={styles.meta}>갱신 안 됨</span> : null}
            </button>
          ))}
        </div>
        <div className={styles.alertRow}>
          <Toggle
            label="평단가 대비 알림"
            checked={rule !== undefined}
            disabled={busy === 'rule'}
            onChange={(on) => void toggleRule(on)}
          />
          <span className={styles.meta}>
            {rule
              ? `${ruleSummary(rule.kind, rule.params, market)}. 수정은 아래 규칙 목록에서 합니다.`
              : '기본은 꺼짐. 켜면 평단가보다 10% 떨어질 때 알립니다(실시간 감시 41종목 한도를 씁니다).'}
          </span>
        </div>
        {error ? <ApiErrorNotice error={error} /> : null}
      </div>
    </Section>
  );
}
