/**
 * V11: 0.1.0에서 업데이트한 사용자(v2 확인 계획 검토 포인트 1).
 * `v0.1.0` 태그의 마이그레이션(001~003)으로 만든 DB에 감시 종목·규칙·이력·분석·브리핑·대시보드를 넣고,
 * 지금 코드의 사이드카(stack.py)를 그 폴더로 띄운다. DB가 올라가고(004~006) 데이터가 그대로이며,
 * 올라간 DB에서 v2 기능(연결, 보유, 평가)이 돈다. 태그가 없으면(얕은 clone) 실패한다.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { templateRoot } from '../../src/dashboard/layout/templates';
import { expect, main, openApp, Stack, test } from './harness';

const DESKTOP = resolve(import.meta.dirname, '../..');
const SIDECAR = resolve(DESKTOP, '../../sidecar');
const MIGRATIONS = 'sidecar/src/vater_core/store/migrations';
const HELPER = join(import.meta.dirname, 'v010_db.py');

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: DESKTOP, encoding: 'utf8', maxBuffer: 1 << 24 });

function schemaVersion(dir: string): number {
  const out = spawnSync(
    'python3',
    [
      '-I',
      '-c',
      'import sqlite3,sys;print(sqlite3.connect(sys.argv[1]).execute("SELECT MAX(version) FROM schema_version").fetchone()[0])',
      join(dir, 'vater.db'),
    ],
    { encoding: 'utf8' },
  );
  return Number(out.stdout.trim());
}

/** 0.1.0이 만든 대시보드 문서: 탭 둘(기본 + 직접 만든 탭). */
const DASHBOARDS = {
  version: 1,
  dashboards: [
    {
      id: 'home',
      name: '기본',
      kpi: { enabled: true, items: ['kospi', 'kosdaq', 'watch-count', 'alerts-today'] },
      layout: { template: 'grid-2x2', root: templateRoot('grid-2x2') },
      panels: [
        { type: 'index-chart', options: { index: 'KOSPI' } },
        { type: 'briefing', options: { market: 'KR' } },
        { type: 'watchlist', options: { market: 'all' } },
        { type: 'recent-alerts', options: {} },
      ],
    },
    {
      id: 'mine',
      name: '내 감시판',
      kpi: { enabled: false, items: [] },
      layout: { template: 'cols-2', root: templateRoot('cols-2') },
      panels: [
        { type: 'watchlist', options: { market: 'KR' } },
        { type: 'recent-alerts', options: {} },
      ],
    },
  ],
};

interface Rule {
  id: number;
  watchlist_id: number;
  kind: string;
  params: Record<string, unknown>;
  timing: string;
  enabled: boolean;
}

test('V11 0.1.0 DB 올리기: 감시 종목·규칙·이력·분석·브리핑·대시보드가 그대로이고 올라간 DB에서 v2가 돈다', async ({
  page,
  shell,
  log,
}) => {
  void shell;
  const work = mkdtempSync(join(tmpdir(), 'vater-accept-v010-'));
  const dataDir = join(work, 'data');
  let stack: Stack | null = null;
  try {
    // 1) v0.1.0 태그의 마이그레이션 파일만으로 DB를 만든다
    const sqlDir = join(work, 'migrations');
    mkdirSync(sqlDir);
    const names = git('ls-tree', '--full-tree', '--name-only', 'v0.1.0', `${MIGRATIONS}/`)
      .split('\n')
      .filter((n) => /\/\d{3}_[a-z0-9_]+\.sql$/.test(n));
    expect(names).toHaveLength(3); // 001, 002, 003
    for (const name of names) {
      writeFileSync(join(sqlDir, name.split('/').pop() as string), git('show', `v0.1.0:${name}`));
    }
    const doc = join(work, 'dashboards.json');
    writeFileSync(doc, JSON.stringify(DASHBOARDS));
    const made = execFileSync(
      'uv',
      ['run', '--project', SIDECAR, 'python', HELPER, dataDir, sqlDir, doc],
      {
        encoding: 'utf8',
      },
    );
    expect(JSON.parse(made)).toEqual({ schema_version: 3 });
    expect(schemaVersion(dataDir)).toBe(3);

    // 2) 지금 코드로 올린다
    stack = await Stack.start(dataDir);
    shell.stack = stack; // 화면이 이 사이드카에 붙는다
    expect(schemaVersion(dataDir)).toBe(6);

    // 3) 데이터가 그대로다
    const watch = await stack.json<{ id: number; code: string; name: string }[]>('/watchlist');
    expect(watch.map((w) => [w.id, w.code, w.name])).toEqual([
      [1, '005930', '삼성전자'],
      [2, 'AAPL', '애플'],
    ]);
    const rules = await stack.json<Rule[]>('/alerts/rules');
    expect(rules.map((r) => [r.id, r.watchlist_id, r.kind, r.params, r.timing, r.enabled])).toEqual(
      [
        [1, 1, 'price_above', { price: 90000 }, 'realtime', true],
        [2, 2, 'change_pct', { pct: 3, direction: 'both' }, 'realtime', false],
      ],
    );
    const events = await stack.json<{ message: string }[]>('/alerts/events');
    expect(events.map((e) => e.message)).toEqual(['삼성전자 현재가 91,000 — 목표가 90,000 이상']);
    const analyses =
      await stack.json<{ id: number; status: string; decision: string | null }[]>('/analyses');
    expect(analyses.map((a) => [a.id, a.status, a.decision])).toEqual([[1, 'done', 'Buy']]);
    const briefings =
      await stack.json<{ id: number; headline: string | null; missing: string[] }[]>('/briefings');
    expect(briefings.map((b) => [b.id, b.headline, b.missing])).toEqual([
      [1, '0.1.0에서 만든 브리핑입니다.', []],
    ]);
    const detail = await stack.json<{ my_assets: unknown }>('/briefings/1');
    expect(detail.my_assets).toBeNull(); // 새 열은 비어 있고 화면이 그것을 견딘다
    expect(await stack.json('/ui/dashboards')).toEqual(DASHBOARDS);
    const settings = await stack.json<Record<string, unknown>>('/settings');
    expect(settings['alerts.poll_interval_sec']).toBe(10);
    expect(settings['briefing.kr.enabled']).toBe(false);
    // v2 설정은 기본값으로 생긴다
    expect([settings['quotes.refresh_sec'], settings['holdings.sync_minutes']]).toEqual([600, 0]);

    // 4) 화면: 직접 만든 탭이 그대로 보이고, 감시 종목과 이력이 보인다
    await stack.setup();
    await openApp(page, '#/home');
    await expect(page.getByRole('tab', { name: '내 감시판' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '기본' })).toBeVisible();
    await page.getByRole('tab', { name: '내 감시판' }).click();
    await expect(
      main(page)
        .getByRole('table', { name: '감시 종목' })
        .getByRole('row', { name: /삼성전자/ }),
    ).toBeVisible();
    await page.evaluate(() => {
      window.location.hash = '#/alerts';
    });
    await expect(
      page
        .getByRole('region', { name: '알림 이력' })
        .getByText('삼성전자 현재가 91,000 — 목표가 90,000 이상'),
    ).toBeVisible();

    // 5) 올라간 DB에서 v2가 돈다: 키움을 연결해 보유를 받고, 이미 있던 감시 종목은 그대로 두고 올린다
    const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
    await stack.json(
      '/connections',
      post({
        broker_id: 'kiwoom',
        app_key: 'fake-kiwoom-key-0000000000',
        app_secret: 'fake-kiwoom-secret-1111111111',
      }),
    );
    await stack.json('/holdings/sync', post({}));
    const held = await stack.json<{ code: string }[]>('/holdings');
    expect(held.map((h) => h.code).sort()).toEqual(['005930', '035420', 'NVDA']);
    const result = await stack.json<{ added: number; skipped: number }>(
      '/holdings/watch',
      post({
        items: [
          { market: 'KR', code: '005930' },
          { market: 'KR', code: '035420' },
        ],
      }),
    );
    expect(result).toMatchObject({ added: 1, skipped: 1 }); // 삼성전자는 이미 감시 중
    expect((await stack.json<{ id: number }[]>('/watchlist')).map((w) => w.id)).toEqual([1, 2, 3]);
    const rulesAfter = await stack.json<Rule[]>('/alerts/rules');
    expect(rulesAfter.map((r) => r.id)).toEqual([1, 2]);
    const s = await stack.json<{ symbols: { code: string; total: string }[] }>(
      '/portfolio/summary',
    );
    expect(s.symbols.map((x) => [x.code, x.total]).sort()).toEqual([
      ['005930', '5'],
      ['035420', '3'],
      ['NVDA', '2'],
    ]);
    expect(log.errors).toEqual([]);

    // 6) 한 번 더 시작해도 그대로(이미 올라간 DB)
    await stack.stop();
    stack = await Stack.start(dataDir);
    expect(schemaVersion(dataDir)).toBe(6);
    expect((await stack.json<unknown[]>('/watchlist')).length).toBe(3);
    expect((await stack.json<unknown[]>('/holdings')).length).toBe(3);
  } finally {
    if (stack) await stack.stop();
    rmSync(work, { recursive: true, force: true });
  }
});
