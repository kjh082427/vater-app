import { useEffect, useState } from 'react';
import { useResource } from '../../api/useResource';
import type { CategoryGroup, CategorySearch, CategoryStock } from '../../api/types';
import { Button, formatNumber, SegmentedControl } from '../../design-system';
import { ApiErrorNotice } from './ApiErrorNotice';
import { Field } from './Field';
import formStyles from './form.module.css';
import styles from './screen.module.css';
import { SymbolResultList, type SymbolSearchProps } from './SymbolSearch';

type Market = 'ALL' | 'KR' | 'US';
const MARKETS: { value: Market; label: string }[] = [
  { value: 'ALL', label: '통합' },
  { value: 'KR', label: '한국' },
  { value: 'US', label: '미국' },
];

/** 한 번에 그리는 종목 수. 미분류는 수천 개일 수 있고 사이드카는 쪽으로 나누지 않는다. */
const PAGE = 100;
const DEBOUNCE_MS = 250;

type Props = Pick<SymbolSearchProps, 'actionLabel' | 'onPick' | 'marked' | 'busyKey'>;

/**
 * 분류로 종목 찾기(스펙 11장): 시장 [통합|한국|미국] 뒤에 대분류 → 중분류. 어느 단계에서 멈춰도 그 아래 종목을
 * 모두 보여 준다. 고른 분류는 시장을 바꿔도 유지한다. 소분류와 주요제품 검색은 v2에 없다.
 * 분류표는 앱에 든 파일이라 사용자 자료나 보유 내역과 무관하다.
 */
export function CategoryBrowser({ actionLabel, onPick, marked, busyKey }: Props) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div>
        <Button size="sm" variant="quiet" onClick={() => setOpen(true)}>
          분류로 찾기
        </Button>
      </div>
    );
  }
  return (
    <Browser
      actionLabel={actionLabel}
      onPick={onPick}
      marked={marked}
      busyKey={busyKey}
      onClose={() => setOpen(false)}
    />
  );
}

function Browser({
  actionLabel,
  onPick,
  marked,
  busyKey,
  onClose,
}: Props & { onClose: () => void }) {
  const [market, setMarket] = useState<Market>('ALL');
  const [node, setNode] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState<{ key: string; n: number }>({ key: '', n: PAGE });
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const tree = useResource<CategoryGroup[]>('/categories');
  const stocks = useResource<CategoryStock[]>(
    node ? `/categories/stocks?node=${node}&market=${market}` : null,
    (api) => api.request<CategoryStock[]>('/categories/stocks', { query: { node, market } }),
  );
  const found = useResource<CategorySearch>(
    query ? `/categories/search?q=${query}&market=${market}` : null,
    (api) => api.request<CategorySearch>('/categories/search', { query: { q: query, market } }),
  );

  const groups = tree.data ?? [];
  const active = groups.find((g) => g.id === node || g.mids.some((m) => m.id === node));
  const listKey = `${node}/${market}`;
  const limit = shown.key === listKey ? shown.n : PAGE;
  const rows = stocks.data ?? [];

  return (
    <div className={styles.inner}>
      <div className={styles.categoryHead}>
        <SegmentedControl
          label="시장"
          size="sm"
          value={market}
          options={MARKETS}
          onChange={setMarket}
        />
        <Button size="sm" variant="quiet" onClick={onClose}>
          분류 닫기
        </Button>
      </div>
      <Field label="분류 검색" hint="분류 이름이나 테마 키워드로 찾습니다. 예: 반도체, HBM">
        {(control) => (
          <input
            {...control}
            className={formStyles.control}
            type="search"
            autoComplete="off"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
          />
        )}
      </Field>
      {tree.error ? (
        <ApiErrorNotice
          error={tree.error}
          title="분류를 불러오지 못했습니다"
          onRetry={tree.reload}
        />
      ) : null}
      {found.error ? <ApiErrorNotice error={found.error} title="분류를 찾지 못했습니다" /> : null}
      {query && found.data ? (
        <>
          {found.data.nodes.length > 0 ? (
            <ul className={styles.nodeHits} aria-label="찾은 분류">
              {found.data.nodes.map((n) => (
                <li key={n.id}>
                  <button type="button" className={styles.node} onClick={() => setNode(n.id)}>
                    <b>{n.name}</b>
                    <span className={styles.stockMeta}>
                      {`${n.parent ?? '대분류'} · ${formatNumber(n.count)}종목${n.match === 'keyword' && n.keyword ? ` · 키워드 ${n.keyword}` : ''}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {found.data.stocks.length > 0 ? (
            <>
              <SymbolResultList
                label="찾은 종목"
                symbols={found.data.stocks.slice(0, PAGE)}
                actionLabel={actionLabel}
                onPick={onPick}
                marked={marked}
                busyKey={busyKey}
              />
              {found.data.stocks.length > PAGE ? (
                <span
                  className={styles.stockMeta}
                >{`상위 ${PAGE}개만 표시, 이름으로 검색해 주세요`}</span>
              ) : null}
            </>
          ) : null}
          {found.data.nodes.length === 0 && found.data.stocks.length === 0 ? (
            <p className={styles.empty}>맞는 분류나 종목이 없습니다. 다른 낱말로 찾아 보세요.</p>
          ) : null}
        </>
      ) : null}
      <div className={styles.nodeRow} role="group" aria-label="대분류">
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            className={styles.node}
            aria-pressed={active?.id === g.id}
            onClick={() => setNode(g.id)}
          >
            {g.name}
          </button>
        ))}
      </div>
      {active && active.mids.length > 0 ? (
        <div className={styles.nodeRow} role="group" aria-label={`${active.name}의 중분류`}>
          {active.mids.map((m) => (
            <button
              key={m.id}
              type="button"
              className={styles.node}
              aria-pressed={node === m.id}
              onClick={() => setNode(m.id)}
            >
              {m.name}
            </button>
          ))}
        </div>
      ) : null}
      {stocks.error ? (
        <ApiErrorNotice
          error={stocks.error}
          title="종목을 불러오지 못했습니다"
          onRetry={stocks.reload}
        />
      ) : null}
      {node && stocks.data && rows.length === 0 ? (
        <p className={styles.empty}>이 분류에는 고른 시장의 종목이 없습니다.</p>
      ) : null}
      {rows.length > 0 ? (
        <>
          <SymbolResultList
            label="분류의 종목"
            symbols={rows.slice(0, limit)}
            actionLabel={actionLabel}
            onPick={onPick}
            marked={marked}
            busyKey={busyKey}
          />
          {rows.length > limit ? (
            <div className={styles.more}>
              <span className={styles.stockMeta}>
                {`${formatNumber(rows.length)}개 중 ${formatNumber(limit)}개를 보고 있습니다. 이름으로 검색하면 더 빨리 찾습니다.`}
              </span>
              <Button size="sm" onClick={() => setShown({ key: listKey, n: limit + PAGE })}>
                더 보기
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
