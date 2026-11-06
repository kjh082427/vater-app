import { useResource } from '../../api/useResource';
import type { HoldingOut, SymbolOut } from '../../api/types';
import form from '../common/form.module.css';
import styles from './holdings.module.css';

type Picked = Pick<SymbolOut, 'market' | 'code' | 'name'>;

/**
 * 분석 창의 "보유 종목에서 고르기"(v0.2.1 21장 3번). 앱 안에서만 보여 주는 목록이다.
 * 고르면 종목 한 개(market·code·name)만 넘긴다: 수량·평단가·증권사는 이 부품 밖으로 나가지 않는다.
 * 같은 종목은 한 번만, 시장을 모르는(지원하지 않는) 종목은 뺀다. 없으면 아무것도 그리지 않는다.
 */
export function HeldSymbolChoices({ onPick }: { onPick: (symbol: Picked) => void }) {
  const holdings = useResource<HoldingOut[]>('/holdings');
  const seen = new Map<string, Picked>();
  for (const h of holdings.data ?? []) {
    if (h.market === null || !h.supported || Number(h.quantity) <= 0) continue;
    seen.set(`${h.market}:${h.code}`, { market: h.market, code: h.code, name: h.name });
  }
  if (seen.size === 0) return null;
  return (
    <div className={styles.heldPick}>
      <span className={form.legend}>보유 종목에서 고르기</span>
      <ul className={styles.heldChoices} aria-label="보유 종목에서 고르기">
        {[...seen].map(([key, s]) => (
          <li key={key}>
            <button
              type="button"
              className={styles.heldChoice}
              aria-label={`보유 종목 ${s.name}`}
              onClick={() => onPick({ market: s.market, code: s.code, name: s.name })}
            >
              <b>{s.name}</b>
              <span className="vt-num">{s.code}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
