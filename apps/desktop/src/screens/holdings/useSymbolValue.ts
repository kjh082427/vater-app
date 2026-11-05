import { useResource } from '../../api/useResource';
import type { PortfolioSummary, SymbolHoldings, SymbolValue } from '../../api/types';

/** 종목 하나의 보유 합계(GET /holdings/symbol)와 평가(GET /portfolio/summary의 그 종목). */
export function useSymbolValue(market: string, code: string) {
  const holdings = useResource<SymbolHoldings>(`/holdings/symbol/${market}/${code}`);
  const summary = useResource<PortfolioSummary>('/portfolio/summary');
  const value: SymbolValue | undefined = summary.data?.symbols.find(
    (s) => s.market === market && s.code === code,
  );
  const held = holdings.data !== undefined && Number(holdings.data.total) > 0;
  return {
    holdings: holdings.data,
    value,
    at: summary.data?.at,
    held,
    error: holdings.error ?? summary.error,
    reload: () => {
      holdings.reload();
      summary.reload();
    },
  };
}
