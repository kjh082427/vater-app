import type { AlertRule, WatchItem } from '../../api/types';
import { ApiErrorNotice } from '../common/ApiErrorNotice';
import { MyHoldingsCard } from './MyHoldingsCard';
import { PriceChart } from './PriceChart';
import { useSymbolValue } from './useSymbolValue';

export interface StockOverviewProps {
  item: WatchItem;
  /** 이 종목의 평단가 알림 규칙. */
  rule: AlertRule | undefined;
  onRulesChanged: () => void;
}

/** 종목 화면의 주가 그래프와 바로 아래 "내 보유" 카드(스펙 4-2). 보유하지 않으면 그래프만. */
export function StockOverview({ item, rule, onRulesChanged }: StockOverviewProps) {
  const sym = useSymbolValue(item.market, item.code);
  return (
    <>
      <PriceChart
        market={item.market}
        code={item.code}
        name={item.name}
        avgPrice={sym.held ? (sym.holdings?.avg_price ?? null) : null}
      />
      {sym.error ? (
        <ApiErrorNotice
          error={sym.error}
          title="내 보유를 불러오지 못했습니다"
          onRetry={sym.reload}
        />
      ) : null}
      {sym.held && sym.holdings ? (
        <MyHoldingsCard
          market={item.market}
          watchlistId={item.id}
          holdings={sym.holdings}
          value={sym.value}
          at={sym.at}
          rule={rule}
          onRulesChanged={onRulesChanged}
          onRefreshed={sym.reload}
        />
      ) : null}
    </>
  );
}
