import { useEffect, useRef, useState } from 'react';
import { useResource } from '../../api/useResource';
import type { SymbolOut } from '../../api/types';
import { Button } from '../../design-system';
import { ApiErrorNotice } from './ApiErrorNotice';
import { CategoryBrowser } from './CategoryBrowser';
import { Field } from './Field';
import formStyles from './form.module.css';
import { StockName } from './quotes';
import styles from './screen.module.css';

const DEBOUNCE_MS = 250;

export const symbolKey = (s: { market: string; code: string }) => `${s.market}:${s.code}`;

export interface SymbolResultListProps {
  label: string;
  symbols: SymbolOut[];
  actionLabel: string;
  onPick: (symbol: SymbolOut) => void;
  marked?: { keys: ReadonlySet<string>; label: string };
  busyKey?: string | null;
}

/** 종목 목록: 종목마다 행동 버튼 하나(이미 표시된 종목은 글자). 검색 결과와 분류 탐색이 같이 쓴다. */
export function SymbolResultList({
  label,
  symbols,
  actionLabel,
  onPick,
  marked,
  busyKey,
}: SymbolResultListProps) {
  return (
    <ul className={styles.results} aria-label={label}>
      {symbols.map((s) => {
        const key = symbolKey(s);
        return (
          <li key={key} className={styles.result}>
            <StockName market={s.market} name={s.name} code={s.code} />
            <span className={styles.stockMeta}>{s.exchange}</span>
            <span className={styles.resultAction}>
              {marked?.keys.has(key) ? (
                <span className={styles.stockMeta}>{marked.label}</span>
              ) : (
                <Button
                  size="sm"
                  busy={busyKey === key}
                  aria-label={`${s.name} ${actionLabel}`}
                  onClick={() => onPick(s)}
                >
                  {actionLabel}
                </Button>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export interface SymbolSearchProps {
  /** 결과마다 붙는 버튼 글자. 예: "추가", "선택". */
  actionLabel: string;
  onPick: (symbol: SymbolOut) => void;
  /** 이 종목들은 버튼 대신 이 글자를 보인다. 예: 이미 감시 중인 종목 → "감시 중". */
  marked?: { keys: ReadonlySet<string>; label: string };
  /** 지금 처리 중인 종목(버튼이 busy). */
  busyKey?: string | null;
  focusOnMount?: boolean;
}

/** 종목 검색(GET /symbols/search): 이름·영문명·코드. 결과마다 행동 버튼 하나. */
export function SymbolSearch({
  actionLabel,
  onPick,
  marked,
  busyKey,
  focusOnMount,
}: SymbolSearchProps) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // 사용자가 [종목 추가]를 눌러 연 검색이면 바로 쓸 수 있게 칸으로 옮긴다
  useEffect(() => {
    if (focusOnMount) inputRef.current?.focus();
  }, [focusOnMount]);
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const results = useResource<SymbolOut[]>(query ? `/symbols/search?q=${query}` : null, (api) =>
    api.request<SymbolOut[]>('/symbols/search', { query: { q: query } }),
  );

  return (
    <div className={styles.inner}>
      <Field label="종목 검색" hint="이름이나 코드로 찾습니다. 예: 삼성전자, 005930, AAPL">
        {(control) => (
          <input
            {...control}
            className={formStyles.control}
            type="search"
            autoComplete="off"
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        )}
      </Field>
      {results.error ? (
        <ApiErrorNotice error={results.error} title="종목을 찾지 못했습니다" />
      ) : null}
      {query && results.data && results.data.length === 0 ? (
        <p className={styles.empty}>
          검색 결과가 없습니다. 이름이나 코드를 확인하세요. 종목 목록을 처음 받는 중이면 잠시 뒤
          다시 찾아 보세요.
        </p>
      ) : null}
      {query && results.data && results.data.length > 0 ? (
        <SymbolResultList
          label="검색 결과"
          symbols={results.data}
          actionLabel={actionLabel}
          onPick={onPick}
          marked={marked}
          busyKey={busyKey}
        />
      ) : null}
      <CategoryBrowser
        actionLabel={actionLabel}
        onPick={onPick}
        marked={marked}
        busyKey={busyKey}
      />
    </div>
  );
}
