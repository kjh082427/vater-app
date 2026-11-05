/**
 * 사이드카 흉내(MSW): 증권사 연결, 보유 내역, 포트폴리오, 분류 탐색(v2).
 * 형식은 OpenAPI 타입을 따르고, 계산은 화면 시험에 필요한 만큼만 사이드카를 따라 한다.
 * 어긋나는 상황(실패, 큰 목록)은 테스트가 `server.use(...)`로 덮어쓴다.
 */
import { http, HttpResponse } from 'msw';
import { maskOf } from '../screens/holdings/mask';
import type {
  Bar,
  BrokerOut,
  CategoryGroup,
  CategoryStock,
  ConnectionOut,
  CsvPreview,
  CsvRow,
  ErrorBody,
  Fx,
  HistoryPoint,
  HoldingOut,
  ManualHolding,
  PortfolioSummary,
  SymbolHoldings,
  SymbolOut,
  SymbolValue,
  Totals,
  WatchItem,
  WatchRequest,
} from '../api/types';

export interface HoldingsDb {
  brokers: BrokerOut[];
  connections: ConnectionOut[];
  holdings: HoldingOut[];
  /** `KR:005930` → 현재가. 없으면 시세 없음. */
  prices: Record<string, number>;
  fx: Fx;
  bars: Record<string, Bar[]>;
  history: HistoryPoint[];
  categories: CategoryGroup[];
  /** 분류 id(대·중·unclassified) → 종목. */
  categoryStocks: Record<string, CategoryStock[]>;
  nextConnectionId: number;
}

export function createHoldingsDb(): HoldingsDb {
  const b = (id: string, name: string, color: string, kind: 'api' | 'manual'): BrokerOut => ({
    id,
    name,
    color,
    kind,
    builtin: true,
  });
  return {
    brokers: [
      b('kis', '한국투자', '#7B634F', 'api'),
      b('meritz', '메리츠', '#D14C34', 'api'),
      b('kiwoom', '키움', '#D4467D', 'api'),
      b('samsung', '삼성', '#1C2FA7', 'manual'),
      b('mirae', '미래에셋', '#D97A00', 'manual'),
    ],
    connections: [],
    holdings: [],
    prices: {},
    fx: { day: '2026-11-06', usdkrw: 1400 },
    bars: {},
    history: [],
    categories: [{ id: 'unclassified', name: '미분류', mids: [] }],
    categoryStocks: { unclassified: [] },
    nextConnectionId: 1,
  };
}

type Db = HoldingsDb & { symbols: SymbolOut[]; watchItems: WatchItem[]; nextId: number };

const err = (status: number, code: string, message: string, hint?: string) =>
  HttpResponse.json({ code, message, hint: hint ?? null } satisfies ErrorBody, { status });
const noContent = () => new HttpResponse(null, { status: 204 });

const num = (s: string) => Number(s);
const fmt = (n: number) => String(Math.round(n * 1e8) / 1e8);

/** 종목 하나의 합계(사이드카 holdings/service.py `summarize`와 같은 규칙). */
export function symbolHoldings(db: HoldingsDb, market: string, code: string): SymbolHoldings {
  const rows = db.holdings.filter((h) => h.market === market && h.code === code);
  const total = rows.reduce((s, h) => s + num(h.quantity), 0);
  const priced = rows.filter((h) => h.avg_price !== null);
  const pricedQty = priced.reduce((s, h) => s + num(h.quantity), 0);
  const cost = priced.reduce((s, h) => s + num(h.quantity) * (h.avg_price ?? 0), 0);
  const stale = new Set(db.connections.filter((c) => c.status !== 'ok').map((c) => c.id));
  const by = new Map<string, number>();
  for (const h of rows) by.set(h.broker_id, (by.get(h.broker_id) ?? 0) + num(h.quantity));
  return {
    total: fmt(total),
    avg_price: pricedQty ? cost / pricedQty : null,
    cost: pricedQty ? cost : null,
    unpriced_quantity: fmt(total - pricedQty),
    currency: rows[0] ? (rows[0].market === 'US' ? 'USD' : 'KRW') : null,
    brokers: [...by.entries()]
      .sort((a, c) => c[1] - a[1])
      .flatMap(([id, qty]) => {
        const info = db.brokers.find((x) => x.id === id);
        return info
          ? [
              {
                broker_id: id,
                name: info.name,
                color: info.color,
                quantity: fmt(qty),
                ratio: total ? (qty / total) * 100 : 0,
                stale: rows.some(
                  (h) => h.broker_id === id && h.connection_id > 0 && stale.has(h.connection_id),
                ),
              },
            ]
          : [];
      }),
  };
}

function totals(value: number | null, cost: number | null): Totals {
  const pl = value !== null && cost !== null ? value - cost : null;
  return { value, cost, pl, pl_pct: pl !== null && cost ? (pl / cost) * 100 : null };
}

function summary(db: HoldingsDb): PortfolioSummary {
  const keys = [
    ...new Set(
      db.holdings.filter((h) => h.market && h.supported).map((h) => `${h.market}:${h.code}`),
    ),
  ];
  const symbols: SymbolValue[] = keys.flatMap((key) => {
    const [market = '', code = ''] = key.split(':');
    const sh = symbolHoldings(db, market, code);
    if (num(sh.total) === 0) return [];
    const price = db.prices[key] ?? null;
    const name = db.holdings.find((h) => h.market === market && h.code === code)?.name ?? code;
    const value = price === null ? null : num(sh.total) * price;
    const pl = value !== null && sh.cost !== null ? value - sh.cost : null;
    return [
      {
        market,
        code,
        name,
        currency: sh.currency,
        total: sh.total,
        avg_price: sh.avg_price,
        cost: sh.cost,
        unpriced_quantity: sh.unpriced_quantity,
        price,
        value,
        pl,
        pl_pct: pl !== null && sh.cost ? (pl / sh.cost) * 100 : null,
      },
    ];
  });
  const currencies: Record<string, Totals> = {};
  for (const cur of new Set(symbols.map((s) => s.currency ?? ''))) {
    const mine = symbols.filter((s) => s.currency === cur && s.value !== null);
    currencies[cur] = totals(
      mine.reduce((s, x) => s + (x.value ?? 0), 0),
      mine.reduce((s, x) => s + (x.cost ?? 0), 0),
    );
  }
  const rate = db.fx.usdkrw;
  const krw = (cur: string, v: number | null) => (cur === 'USD' && rate ? (v ?? 0) * rate : v);
  const all = Object.entries(currencies);
  return {
    at: '2026-11-06T14:05:00+09:00',
    currencies,
    missing_prices: symbols.filter((s) => s.value === null).length,
    symbols,
    total_krw:
      all.length === 0 || (currencies.USD && !rate)
        ? null
        : totals(
            all.reduce((s, [c, t]) => s + (krw(c, t.value) ?? 0), 0),
            all.reduce((s, [c, t]) => s + (krw(c, t.cost) ?? 0), 0),
          ),
    unsupported: db.holdings.filter((h) => !h.supported).length,
    usdkrw: rate,
  };
}

function parseCsv(raw: string): string[][] {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => l.split(',').map((c) => c.trim()));
}

function previewCsv(
  db: Db,
  brokerId: string,
  text: string,
  cols: Record<'name' | 'code' | 'quantity' | 'avg_price', string | null>,
): CsvPreview {
  const [head = [], ...table] = parseCsv(text);
  const find = (re: RegExp) => head.find((h) => re.test(h)) ?? null;
  const guess = {
    name: find(/종목명|name/i),
    code: find(/종목코드|code|symbol/i),
    quantity: find(/수량|qty|quantity/i),
    avg_price: find(/평균|평단|avg|price/i),
  };
  const use = {
    name: cols.name ?? guess.name,
    code: cols.code ?? guess.code,
    quantity: cols.quantity ?? guess.quantity,
    avg_price: cols.avg_price ?? guess.avg_price,
  };
  // 사이드카처럼: 종목(이름이나 코드)과 수량 열을 모르면 아직 행을 만들지 않는다
  const body = (use.name || use.code) && use.quantity ? table : [];
  const at = (row: string[], col: string | null) => (col ? (row[head.indexOf(col)] ?? '') : '');
  const rows: CsvRow[] = body.map((row, i) => {
    const name = at(row, use.name);
    const code = at(row, use.code);
    const quantity = at(row, use.quantity);
    const avg = Number(at(row, use.avg_price));
    const exact = db.symbols.filter((s) => (code ? s.code === code : s.name === name));
    const near = db.symbols.filter((s) => name !== '' && s.name.includes(name.slice(0, 2)));
    const base = { row: i + 2, name: name || code, quantity: quantity || null };
    const candidates = (exact.length === 1 ? [] : near).map((s) => ({
      market: s.market,
      code: s.code,
      name: s.name,
    }));
    const bad =
      !quantity || Number.isNaN(Number(quantity))
        ? '수량이 비어 있거나 숫자가 아닙니다.'
        : !(avg > 0)
          ? '평균 매수가가 비어 있거나 숫자가 아닙니다.'
          : exact.length === 0
            ? '종목을 찾을 수 없습니다.'
            : null;
    const hit = exact.length === 1 ? exact[0] : undefined;
    return {
      ...base,
      market: (hit?.market as 'KR' | 'US' | undefined) ?? null,
      code: hit?.code ?? null,
      avg_price: avg > 0 ? avg : null,
      error: bad,
      candidates,
    };
  });
  const mine = db.holdings.filter((h) => h.broker_id === brokerId && h.source !== 'api');
  const keys = new Set(rows.flatMap((r) => (r.code ? [`${r.market}:${r.code}`] : [])));
  return {
    columns: head,
    guess,
    rows,
    changes: {
      added: [...keys].filter((k) => !mine.some((h) => `${h.market}:${h.code}` === k)).length,
      updated: [...keys].filter((k) => mine.some((h) => `${h.market}:${h.code}` === k)).length,
      removed: mine.filter((h) => !keys.has(`${h.market}:${h.code}`)).length,
    },
  };
}

function upsert(db: Db, broker: string, m: ManualHolding, source: 'manual' | 'csv') {
  const sym = db.symbols.find((s) => s.market === m.market && s.code === m.code);
  if (!sym) return false;
  db.holdings = db.holdings.filter(
    (h) => !(h.broker_id === broker && h.market === m.market && h.code === m.code),
  );
  db.holdings.push({
    broker_id: broker,
    connection_id: 0,
    market: m.market,
    code: m.code,
    name: sym.name,
    quantity: String(m.quantity),
    avg_price: Number(m.avg_price),
    currency: m.market === 'US' ? 'USD' : 'KRW',
    source,
    updated_at: '2026-11-06T14:00:00+09:00',
    supported: true,
    unsupported_reason: null,
    is_new: false,
  });
  return true;
}

export function holdingsHandlers(db: Db) {
  return [
    http.get('*/brokers', () => HttpResponse.json(db.brokers)),
    http.post('*/brokers', async ({ request }) => {
      const { name } = (await request.json()) as { name: string };
      if (db.brokers.some((b) => b.name === name)) {
        return err(409, 'BROKER_DUPLICATE', '이미 있는 증권사입니다.');
      }
      const palette = ['#2E8B57', '#008B8B', '#8E44AD'];
      const made: BrokerOut = {
        id: `custom-${db.nextId++}`,
        name,
        color: palette[db.brokers.filter((x) => !x.builtin).length % palette.length] as string,
        kind: 'manual',
        builtin: false,
      };
      db.brokers.push(made);
      return HttpResponse.json(made, { status: 201 });
    }),
    http.delete('*/brokers/:id/data', ({ params }) => {
      const id = String(params.id);
      if (db.connections.some((c) => c.broker_id === id && c.status === 'ok')) {
        return err(
          409,
          'BROKER_CONNECTED',
          '연결 중인 증권사의 내역은 다음 갱신 때 다시 채워집니다.',
          '연결을 먼저 해제해 주세요.',
        );
      }
      db.connections = db.connections.filter((c) => c.broker_id !== id);
      db.holdings = db.holdings.filter((h) => h.broker_id !== id);
      return noContent();
    }),
    http.get('*/connections', () => HttpResponse.json(db.connections)),
    http.post('*/connections', async ({ request }) => {
      const body = (await request.json()) as {
        broker_id: string;
        app_key?: string | null;
        account?: string | null;
        replaces?: number | null;
      };
      if (!db.brokers.some((b) => b.id === body.broker_id && b.kind === 'api')) {
        return err(404, 'BROKER_UNKNOWN', '지원하지 않는 증권사입니다.');
      }
      const mask = await maskOf(body.broker_id, body.account ?? '', body.app_key ?? '');
      if (
        db.connections.some(
          (c) =>
            c.broker_id === body.broker_id &&
            c.account_mask === mask &&
            c.status !== 'disconnected' &&
            c.id !== body.replaces,
        )
      ) {
        return err(409, 'BROKER_DUPLICATE', '이미 연결된 계좌입니다.');
      }
      const made: ConnectionOut = {
        id: db.nextConnectionId++,
        broker_id: body.broker_id,
        account_mask: mask,
        status: 'ok',
        last_synced_at: '2026-11-06T14:00:00+09:00',
        last_error: null,
        server: body.broker_id === 'kis' ? 'prod' : null,
      };
      if (body.replaces != null) {
        db.connections = db.connections.filter((c) => c.id !== body.replaces);
        db.holdings = db.holdings.filter((h) => h.connection_id !== body.replaces);
      }
      db.connections.push(made);
      return HttpResponse.json(made, { status: 201 });
    }),
    http.delete('*/connections/:id', ({ params, request }) => {
      const id = Number(params.id);
      const drop = new URL(request.url).searchParams.get('delete_data') === 'true';
      const conn = db.connections.find((c) => c.id === id);
      if (!conn) return err(404, 'CONNECTION_NOT_FOUND', '연결을 찾을 수 없습니다.');
      if (drop) {
        db.connections = db.connections.filter((c) => c.id !== id);
        db.holdings = db.holdings.filter((h) => h.connection_id !== id);
      } else {
        conn.status = 'disconnected';
      }
      return noContent();
    }),
    http.post('*/holdings/sync', async ({ request }) => {
      const { broker_id } = (await request.json()) as { broker_id?: string | null };
      return HttpResponse.json(
        db.connections
          .filter((c) => c.status === 'ok' && (!broker_id || c.broker_id === broker_id))
          .map((c) => ({ connection_id: c.id, broker_id: c.broker_id, ok: true, error: null })),
      );
    }),
    http.get('*/holdings', () => HttpResponse.json(db.holdings)),
    http.get('*/holdings/symbol/:market/:code', ({ params }) =>
      HttpResponse.json(symbolHoldings(db, String(params.market), String(params.code))),
    ),
    http.put('*/holdings/manual', async ({ request }) => {
      const body = (await request.json()) as ManualHolding;
      if (!(Number(body.quantity) > 0) || !(Number(body.avg_price) > 0)) {
        return err(422, 'HOLDING_INVALID', '수량과 평균 매수가는 0보다 커야 합니다.');
      }
      return upsert(db, body.broker_id, body, 'manual')
        ? noContent()
        : err(404, 'SYMBOL_UNKNOWN', '종목을 찾을 수 없습니다.');
    }),
    http.delete('*/holdings/manual', async ({ request }) => {
      const k = (await request.json()) as { broker_id: string; market: string; code: string };
      db.holdings = db.holdings.filter(
        (h) => !(h.broker_id === k.broker_id && h.market === k.market && h.code === k.code),
      );
      return noContent();
    }),
    http.post('*/holdings/csv/preview', async ({ request }) => {
      const q = new URL(request.url).searchParams;
      const text = await request.text();
      return HttpResponse.json(
        previewCsv(db, q.get('broker_id') ?? '', text, {
          name: q.get('name_col'),
          code: q.get('code_col'),
          quantity: q.get('quantity_col'),
          avg_price: q.get('avg_price_col'),
        }),
      );
    }),
    http.post('*/holdings/csv/commit', async ({ request }) => {
      const body = (await request.json()) as {
        broker_id: string;
        rows: Omit<ManualHolding, 'broker_id'>[];
      };
      const keys = body.rows.map((r) => `${r.market}:${r.code}`);
      if (body.rows.length === 0 || new Set(keys).size !== keys.length) {
        return err(422, 'CSV_INVALID', '올릴 행이 없거나 같은 종목이 두 번 있습니다.');
      }
      db.holdings = db.holdings.filter(
        (h) => !(h.broker_id === body.broker_id && h.source !== 'api'),
      );
      for (const r of body.rows)
        upsert(db, body.broker_id, { ...r, broker_id: body.broker_id }, 'csv');
      return noContent();
    }),
    http.post('*/holdings/watch', async ({ request }) => {
      const body = (await request.json()) as WatchRequest;
      let added = 0;
      let skipped = 0;
      for (const t of body.items) {
        const sym = db.symbols.find((s) => s.market === t.market && s.code === t.code);
        if (!sym || db.watchItems.some((w) => w.market === t.market && w.code === t.code)) {
          skipped += 1;
          continue;
        }
        db.watchItems.push({
          id: db.nextId++,
          market: sym.market,
          code: sym.code,
          exchange: sym.exchange,
          name: sym.name,
          created_at: '2026-11-06T14:00:00+09:00',
        });
        added += 1;
      }
      const seen = new Set(
        [...body.items, ...(body.seen ?? [])].map((t) => `${t.market}:${t.code}`),
      );
      for (const h of db.holdings) if (seen.has(`${h.market}:${h.code}`)) h.is_new = false;
      return HttpResponse.json({ added, skipped, rules: body.rule ? added : 0 });
    }),

    http.get('*/portfolio/summary', () => HttpResponse.json(summary(db))),
    http.get('*/portfolio/history', () => HttpResponse.json(db.history)),
    http.get('*/market/fx', ({ request }) => {
      if (new URL(request.url).searchParams.get('refresh') === 'true') db.fx = { ...db.fx };
      return HttpResponse.json(db.fx);
    }),
    http.get('*/symbols/:market/:code/bars', ({ params }) =>
      HttpResponse.json(db.bars[`${String(params.market)}:${String(params.code)}`] ?? []),
    ),

    http.get('*/categories', () => HttpResponse.json(db.categories)),
    http.get('*/categories/stocks', ({ request }) => {
      const q = new URL(request.url).searchParams;
      const rows = db.categoryStocks[q.get('node') ?? ''];
      const market = q.get('market') ?? 'ALL';
      return rows
        ? HttpResponse.json(rows.filter((s) => market === 'ALL' || s.market === market))
        : err(404, 'CATEGORY_NOT_FOUND', '없는 분류입니다.');
    }),
    http.get('*/categories/search', ({ request }) => {
      const q = new URL(request.url).searchParams;
      const word = (q.get('q') ?? '').toLowerCase();
      const market = q.get('market') ?? 'ALL';
      const all = Object.values(db.categoryStocks).flat();
      const stocks = [...new Map(all.map((s) => [`${s.market}:${s.code}`, s])).values()].filter(
        (s) => s.name.toLowerCase().includes(word) && (market === 'ALL' || s.market === market),
      );
      const nodes = db.categories.flatMap((g) => [
        ...(g.name.includes(word)
          ? [
              {
                id: g.id,
                name: g.name,
                level: 'group' as const,
                parent: null,
                match: 'name' as const,
                keyword: null,
                count: db.categoryStocks[g.id]?.length ?? 0,
              },
            ]
          : []),
        ...g.mids
          .filter((m) => m.name.includes(word))
          .map((m) => ({
            id: m.id,
            name: m.name,
            level: 'mid' as const,
            parent: g.name,
            match: 'name' as const,
            keyword: null,
            count: db.categoryStocks[m.id]?.length ?? 0,
          })),
      ]);
      return HttpResponse.json({ nodes, stocks });
    }),
  ];
}
