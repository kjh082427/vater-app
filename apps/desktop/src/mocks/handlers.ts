/**
 * 사이드카 흉내(MSW 요청 처리기). 출처(포트)와 상관없이 경로로 맞춘다: `*\/watchlist`.
 * 상태가 있는 자료(감시 종목, 규칙, 분석)는 `createMockDb()`가 만든 메모리 저장소에 둔다.
 * 오류 응답은 사이드카와 같은 `{code, message, hint}` 형식이다.
 */
import { http, HttpResponse } from 'msw';
import type {
  AlertEvent,
  AlertRule,
  AnalysisCreate,
  AnalysisDetail,
  BriefingDetail,
  ErrorBody,
  HardwareOut,
  OllamaStatus,
  MonitorStatus,
  RuleCreate,
  RulePatch,
  RulePreviewIn,
  SymbolOut,
  WatchItem,
  WatchQuote,
} from '../api/types';
import * as fx from './fixtures';
import { createHoldingsDb, holdingsHandlers, type HoldingsDb } from './holdings';

export interface MockDb extends HoldingsDb {
  watchItems: WatchItem[];
  watchQuotes: WatchQuote[];
  monitor: MonitorStatus;
  events: AlertEvent[];
  rules: AlertRule[];
  analyses: AnalysisDetail[];
  briefings: BriefingDetail[];
  settings: Record<string, unknown>;
  secrets: Record<string, boolean>;
  ollama: OllamaStatus;
  hardware: HardwareOut;
  symbols: SymbolOut[];
  /** 대시보드 문서(GET·PUT /ui/dashboards). 처음엔 사이드카처럼 빈 문서. */
  dashboards: unknown;
  indices: (typeof fx.marketIndices)[number][];
  nextId: number;
}

const clone = <T>(value: T): T => structuredClone(value);

export function createMockDb(): MockDb {
  return {
    ...createHoldingsDb(),
    watchItems: clone(fx.watchItems),
    watchQuotes: clone(fx.watchQuotes),
    monitor: clone(fx.monitorStatus),
    events: clone(fx.alertEvents),
    rules: clone(fx.alertRules),
    analyses: clone(fx.analysisDetails),
    briefings: clone([fx.briefingKr, fx.briefingUs]),
    settings: clone(fx.settings),
    secrets: clone(fx.secrets),
    ollama: clone(fx.ollamaStatus),
    hardware: clone(fx.hardware),
    symbols: clone(fx.symbols),
    dashboards: { version: 1, dashboards: [] },
    indices: clone(fx.marketIndices),
    nextId: 100,
  };
}

export function errorResponse(status: number, code: string, message: string, hint?: string) {
  const body: ErrorBody = { code, message, hint: hint ?? null };
  return HttpResponse.json(body, { status });
}

/** 사이드카 store/dashboards.py와 같은 모양 확인(뜻은 화면이 본다). 틀리면 이유, 맞으면 null. */
function dashboardProblem(doc: unknown): string | null {
  const rec = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!rec(doc) || doc.version !== 1) return 'version은 1이어야 합니다';
  const boards = doc.dashboards;
  if (!Array.isArray(boards) || boards.length < 1 || boards.length > 8) {
    return '화면은 1~8장이어야 합니다';
  }
  for (const [i, b] of boards.entries()) {
    const where = `${i + 1}번째 화면`;
    if (!rec(b)) return `${where}이 객체가 아닙니다`;
    if (typeof b.name !== 'string' || b.name.trim().length < 1 || b.name.length > 20) {
      return `${where}의 이름은 1~20자여야 합니다`;
    }
    if (!Array.isArray(b.panels) || b.panels.length < 1 || b.panels.length > 6) {
      return `${where}의 칸은 1~6개여야 합니다`;
    }
  }
  return null;
}

const notFound = () => errorResponse(404, 'NOT_FOUND', '요청한 경로가 없습니다.');

export function createHandlers(db: MockDb) {
  return [
    ...holdingsHandlers(db),
    http.get('*/ui/dashboards', () => HttpResponse.json(db.dashboards as object)),
    http.put('*/ui/dashboards', async ({ request }) => {
      const body: unknown = await request.json();
      const problem = dashboardProblem(body);
      if (problem) {
        return errorResponse(
          422,
          'DASHBOARD_INVALID',
          `화면 배치를 저장하지 못했습니다: ${problem}`,
          '화면을 다시 불러온 뒤 다시 시도하세요.',
        );
      }
      db.dashboards = body;
      return HttpResponse.json(body as object);
    }),
    http.get('*/market/indices', () => HttpResponse.json(db.indices)),
    http.get('*/health', () => HttpResponse.json({ status: 'ok', version: '0.1.0' })),
    http.get('*/secrets', () => HttpResponse.json(db.secrets)),
    http.put('*/secrets/:name', async ({ params, request }) => {
      const name = String(params.name);
      if (!(name in db.secrets)) {
        return errorResponse(400, 'SECRET_NAME_INVALID', '저장할 수 없는 비밀키 이름입니다.');
      }
      const body = (await request.json()) as { value?: unknown };
      if (typeof body.value !== 'string' || body.value.trim() === '') {
        return errorResponse(400, 'SECRET_VALUE_EMPTY', '값이 비어 있습니다.');
      }
      db.secrets[name] = true; // 흉내도 값은 저장하지 않는다(있다는 사실만)
      return new HttpResponse(null, { status: 204 });
    }),
    http.get('*/settings', () => HttpResponse.json(db.settings)),
    http.patch('*/settings', async ({ request }) => {
      const changes = (await request.json()) as Record<string, unknown>;
      for (const [key, value] of Object.entries(changes)) {
        if (
          key.endsWith('.time') &&
          !(typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value))
        ) {
          return errorResponse(
            422,
            'SETTING_INVALID',
            `설정 '${key}' 값이 올바르지 않습니다: HH:MM 형식(00:00~23:59)이어야 합니다`,
          );
        }
      }
      Object.assign(db.settings, changes);
      return HttpResponse.json(db.settings);
    }),
    http.post('*/settings/kis/test', () =>
      HttpResponse.json({
        ok: true,
        server: String(db.settings['kis.server'] ?? 'prod'),
        sample: { code: '005930', price: 71400 },
      }),
    ),
    http.post('*/settings/llm/test', ({ request }) => {
      const provider = new URL(request.url).searchParams.get('provider') ?? 'google';
      return HttpResponse.json({ ok: true, provider, model_count: 12, defaults_available: true });
    }),
    http.get('*/llm/check', () => HttpResponse.json(fx.llmCheck)),
    http.get('*/llm/catalog', () => HttpResponse.json(fx.catalog)),
    http.get('*/llm/hardware', () => HttpResponse.json(db.hardware)),
    http.get('*/llm/ollama/status', () => HttpResponse.json(db.ollama)),
    http.post('*/llm/ollama/start', () => {
      db.ollama.running = db.ollama.installed;
      return HttpResponse.json({ running: db.ollama.running });
    }),
    http.post('*/llm/ollama/install', () =>
      HttpResponse.json({ started: !db.ollama.running }, { status: 202 }),
    ),
    http.post('*/llm/models/:tag/pull', ({ params }) => {
      const model = fx.catalog.local_models.find((m) => m.tag === params.tag);
      if (!model) return notFound();
      if (!db.ollama.running) {
        return errorResponse(
          503,
          'OLLAMA_NOT_RUNNING',
          'Ollama가 실행 중이 아닙니다.',
          'Ollama를 시작하세요.',
        );
      }
      return HttpResponse.json({ started: true, variant: model.variant }, { status: 202 });
    }),
    http.delete('*/llm/models/:tag', ({ params }) => {
      const model = fx.catalog.local_models.find((m) => m.tag === params.tag);
      if (!model) return notFound();
      db.ollama.models = db.ollama.models.filter(
        (m) => m.name !== model.variant && m.name !== model.tag,
      );
      if (db.settings['llm.local_model'] === model.tag) db.settings['llm.local_model'] = '';
      return new HttpResponse(null, { status: 204 });
    }),

    // ---- 종목·감시 종목 ----
    http.get('*/symbols/search', ({ request }) => {
      const q = (new URL(request.url).searchParams.get('q') ?? '').trim().toLowerCase();
      const hits = db.symbols.filter(
        (s) =>
          q !== '' &&
          (s.name.toLowerCase().includes(q) ||
            s.code.toLowerCase().includes(q) ||
            (s.name_en ?? '').toLowerCase().includes(q)),
      );
      return HttpResponse.json(hits);
    }),
    http.get('*/watchlist', () => HttpResponse.json(db.watchItems)),
    http.get('*/watchlist/quotes', () => HttpResponse.json(db.watchQuotes)),
    http.post('*/watchlist', async ({ request }) => {
      const body = (await request.json()) as { market: string; code: string };
      const found = db.symbols.find((s) => s.market === body.market && s.code === body.code);
      if (!found) return errorResponse(404, 'SYMBOL_NOT_FOUND', '종목을 찾을 수 없습니다.');
      if (db.watchItems.some((w) => w.market === body.market && w.code === body.code)) {
        return errorResponse(
          409,
          'WATCHLIST_DUPLICATE',
          `이미 감시 중인 종목입니다: ${found.name}`,
        );
      }
      const item: WatchItem = {
        id: db.nextId++,
        market: found.market,
        code: found.code,
        exchange: found.exchange,
        name: found.name,
        created_at: '2026-11-03T14:40:00+09:00',
      };
      db.watchItems.push(item);
      db.watchQuotes.push({
        watchlist_id: item.id,
        market: item.market,
        code: item.code,
        name: item.name,
        price: null,
        change: null,
        change_pct: null,
        at: null,
        feed: 'idle',
        source: null,
      });
      return HttpResponse.json(item, { status: 201 });
    }),
    http.delete('*/watchlist/:wid', ({ params }) => {
      const id = Number(params.wid);
      if (!db.watchItems.some((w) => w.id === id)) return notFound();
      db.watchItems = db.watchItems.filter((w) => w.id !== id);
      db.watchQuotes = db.watchQuotes.filter((q) => q.watchlist_id !== id);
      db.rules = db.rules.filter((r) => r.watchlist_id !== id);
      return new HttpResponse(null, { status: 204 });
    }),

    // ---- 알림 ----
    http.get('*/alerts/status', () => HttpResponse.json(db.monitor)),
    http.post('*/alerts/pause', () => {
      db.monitor.state = 'paused';
      return HttpResponse.json({ state: db.monitor.state });
    }),
    http.post('*/alerts/resume', () => {
      db.monitor.state = 'running';
      return HttpResponse.json({ state: db.monitor.state });
    }),
    http.get('*/alerts/kinds', () => HttpResponse.json(fx.alertKinds)),
    http.get('*/alerts/events', ({ request }) => {
      const limit = Number(new URL(request.url).searchParams.get('limit') ?? 100);
      return HttpResponse.json(db.events.slice(0, limit));
    }),
    http.get('*/alerts/rules', ({ request }) => {
      const wid = new URL(request.url).searchParams.get('watchlist_id');
      const rules = wid ? db.rules.filter((r) => r.watchlist_id === Number(wid)) : db.rules;
      return HttpResponse.json(rules);
    }),
    http.post('*/alerts/rules/preview', async ({ request }) => {
      const body = (await request.json()) as RulePreviewIn;
      if (body.kind === 'price_above') {
        const price = Number(body.params?.price ?? 0);
        return HttpResponse.json({
          state: 71400 >= price,
          value: 71400,
          message: `현재가 71,400 — 목표가 ${price.toLocaleString('ko-KR')} 이상`,
        });
      }
      return HttpResponse.json({ state: false, value: 48.2, message: 'RSI(14) 48.2' });
    }),
    http.post('*/alerts/rules', async ({ request }) => {
      const body = (await request.json()) as RuleCreate;
      const kind = fx.alertKinds.find((k) => k.kind === body.kind);
      if (!kind) return errorResponse(422, 'ALERT_RULE_INVALID', '알 수 없는 알림 종류입니다.');
      const params = { ...kind.params, ...(body.params ?? {}) };
      const missing = kind.required.filter((name) => params[name] === undefined);
      if (missing.length > 0) {
        return errorResponse(
          422,
          'ALERT_RULE_INVALID',
          '알림 조건 값이 올바르지 않습니다.',
          `확인할 항목: ${missing.join(', ')}`,
        );
      }
      const rule: AlertRule = {
        id: db.nextId++,
        watchlist_id: body.watchlist_id,
        kind: body.kind,
        params,
        timing: body.timing ?? kind.timing,
        enabled: body.enabled ?? true,
        last_state: null,
        last_fired_at: null,
      };
      db.rules.push(rule);
      return HttpResponse.json(rule, { status: 201 });
    }),
    http.patch('*/alerts/rules/:rid', async ({ params, request }) => {
      const rule = db.rules.find((r) => r.id === Number(params.rid));
      if (!rule) return notFound();
      const body = (await request.json()) as RulePatch;
      if (body.params) rule.params = { ...rule.params, ...body.params };
      if (body.timing) rule.timing = body.timing;
      if (typeof body.enabled === 'boolean') rule.enabled = body.enabled;
      return HttpResponse.json(rule);
    }),
    http.delete('*/alerts/rules/:rid', ({ params }) => {
      const id = Number(params.rid);
      if (!db.rules.some((r) => r.id === id)) return notFound();
      db.rules = db.rules.filter((r) => r.id !== id);
      return new HttpResponse(null, { status: 204 });
    }),

    // ---- 분석 ----
    http.get('*/analyses', ({ request }) => {
      const url = new URL(request.url);
      const market = url.searchParams.get('market');
      const code = url.searchParams.get('code');
      const rows = db.analyses
        .filter((a) => (!market || a.market === market) && (!code || a.code === code))
        .sort((a, b) => b.id - a.id)
        .map(({ id, market, code, name, as_of, preset, status, decision, ...rest }) => ({
          id,
          market,
          code,
          name,
          as_of,
          preset,
          status,
          decision,
          decision_ko: rest.decision_ko,
          decision_changed: rest.decision_changed,
          created_at: rest.created_at,
        }));
      return HttpResponse.json(rows);
    }),
    http.get('*/analyses/:aid', ({ params }) => {
      const found = db.analyses.find((a) => a.id === Number(params.aid));
      return found
        ? HttpResponse.json(found)
        : errorResponse(404, 'ANALYSIS_NOT_FOUND', '분석 기록이 없습니다.');
    }),
    http.post('*/analyses', async ({ request }) => {
      const body = (await request.json()) as AnalysisCreate;
      const symbol = db.symbols.find((s) => s.market === body.market && s.code === body.code);
      const detail: AnalysisDetail = {
        ...fx.analysisDone,
        id: db.nextId++,
        market: body.market,
        code: body.code,
        name: symbol?.name ?? null,
        as_of: body.as_of ?? '2026-11-03',
        preset: body.preset ?? 'cloud',
        status: 'queued',
        decision: null,
        decision_ko: null,
        decision_changed: false,
        summary: null,
        price_target: null,
        time_horizon: null,
        reports: null,
        timings: null,
        tokens: null,
        error: null,
        created_at: '2026-11-03T14:40:00+09:00',
      };
      db.analyses.push(detail);
      return HttpResponse.json({ id: detail.id, status: 'queued' }, { status: 202 });
    }),
    http.post('*/analyses/:aid/cancel', ({ params }) => {
      const found = db.analyses.find((a) => a.id === Number(params.aid));
      if (!found) return notFound();
      if (found.status !== 'queued' && found.status !== 'running') {
        return errorResponse(
          409,
          'ANALYSIS_NOT_CANCELLABLE',
          `이미 끝난 분석은 취소할 수 없습니다 (${found.status}).`,
        );
      }
      const status = found.status === 'queued' ? 'cancelled' : 'cancelling';
      if (status === 'cancelled') found.status = 'cancelled';
      return HttpResponse.json({ id: found.id, status });
    }),
    http.post('*/analyses/:aid/retry', ({ params }) => {
      const found = db.analyses.find((a) => a.id === Number(params.aid));
      if (!found) return notFound();
      if (found.status !== 'failed' && found.status !== 'cancelled') {
        return errorResponse(
          409,
          'ANALYSIS_NOT_RETRYABLE',
          '실패하거나 취소한 분석만 다시 시도할 수 있습니다.',
        );
      }
      const next: AnalysisDetail = {
        ...found,
        id: db.nextId++,
        status: 'queued',
        error: null,
        timings: null,
        tokens: null,
      };
      db.analyses.push(next);
      return HttpResponse.json({ id: next.id, status: 'queued' }, { status: 202 });
    }),

    http.delete('*/analyses/:aid', ({ params }) => {
      const found = db.analyses.find((a) => a.id === Number(params.aid));
      if (!found) return errorResponse(404, 'ANALYSIS_NOT_FOUND', '분석 기록이 없습니다.');
      if (found.status === 'queued' || found.status === 'running') {
        return errorResponse(409, 'ANALYSIS_IN_PROGRESS', '진행 중인 분석은 지울 수 없습니다.');
      }
      db.analyses = db.analyses.filter((a) => a !== found);
      return new HttpResponse(null, { status: 204 });
    }),
    http.post('*/analyses/delete', async ({ request }) => {
      const { ids } = (await request.json()) as { ids: number[] };
      const deleted: number[] = [];
      const skipped: { id: number; code: 'ANALYSIS_NOT_FOUND' | 'ANALYSIS_IN_PROGRESS' }[] = [];
      for (const id of ids) {
        const found = db.analyses.find((a) => a.id === id);
        if (!found) skipped.push({ id, code: 'ANALYSIS_NOT_FOUND' });
        else if (found.status === 'queued' || found.status === 'running')
          skipped.push({ id, code: 'ANALYSIS_IN_PROGRESS' });
        else deleted.push(id);
      }
      db.analyses = db.analyses.filter((a) => !deleted.includes(a.id));
      return HttpResponse.json({ deleted, skipped });
    }),

    // ---- 브리핑 ----
    http.get('*/briefings', ({ request }) => {
      const url = new URL(request.url);
      const market = url.searchParams.get('market');
      const limit = Number(url.searchParams.get('limit') ?? 30);
      const rows = db.briefings
        .filter((b) => !market || b.market === market)
        .slice(0, limit)
        .map(({ id, market, date, status, missing, headline, created_at }) => ({
          id,
          market,
          date,
          status,
          missing,
          headline,
          created_at,
        }));
      return HttpResponse.json(rows);
    }),
    http.get('*/briefings/:bid', ({ params }) => {
      const found = db.briefings.find((b) => b.id === Number(params.bid));
      return found ? HttpResponse.json(found) : notFound();
    }),
  ];
}
