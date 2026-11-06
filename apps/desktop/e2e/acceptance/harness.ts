/**
 * 4단계 확인 U의 판: 실제 사이드카(stack.py) + 가짜 Tauri 셸 + Vite 개발 서버의 실제 화면.
 *
 * - 화면 출처는 Windows WebView2와 같은 `http://tauri.localhost`다. 이 출처의 요청은 Playwright가
 *   Vite 개발 서버(5183)로 넘긴다. 그래서 사이드카는 설치한 앱과 같은 CORS(Tauri 출처만)로 돈다.
 *   Vite의 HMR WebSocket은 열어 두기만 한다(끊기면 Vite가 페이지를 새로 고치므로).
 * - 가짜 셸: `@tauri-apps/api`가 쓰는 전역(`isTauri`, `__TAURI_INTERNALS__`)을 넣어 화면이
 *   `createTauriPlatform` 경로로 돈다. 커맨드는 테스트 쪽 FakeShell이 답한다.
 * - 사이드카: 테스트마다 새 데이터 폴더로 stack.py를 띄운다(필요하면 같은 폴더로 다시 띄운다).
 */
import { test as base, expect, type Page, type Request } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const DESKTOP = resolve(import.meta.dirname, '../..');
const SIDECAR = resolve(DESKTOP, '../../sidecar');
const STACK_PY = join(DESKTOP, 'e2e/acceptance/stack.py');
export const VITE_PORT = 5183;
export const APP_ORIGIN = 'http://tauri.localhost';

/** stack.py가 화면 밖에서 넣는 가짜 키(stack.py FAKE_SECRETS와 같은 값). 실제 키가 아니다. */
export const FAKE_SECRET_VALUES = [
  'PSacceptanceFAKEappKEY000000000000000',
  'acceptance-fake-app-secret-not-real',
  'acceptance-fake-llm-key-not-real',
];

export interface Notify {
  at: number;
  title: string;
  body: string;
  route: string | null;
}

export interface StackState {
  subscribed: string[];
  ws_open: number;
  ws_accepted: number;
  rest_paths: string[];
  rest_trs: string[];
  /** 가짜 키움·메리츠가 받은 호출("METHOD /경로"). 허용 밖은 "UNEXPECTED"로 시작한다. */
  broker_calls: { kiwoom: string[]; meritz: string[] };
  /** 브리핑 AI 흉내가 받은 요청 전체(프롬프트 조립 결과). */
  ai_inputs: string[];
  tokens_issued: number;
  monitor: { state: string; realtime: number; polling: number };
  pid: number;
}

const running = new Set<Stack>();

/** 실제 사이드카 프로세스 하나(stack.py). */
export class Stack {
  private exited = false;

  private constructor(
    /** 사이드카가 stdout으로 보낸 notify(셸이 Windows 알림으로 띄우는 것). */
    readonly notifies: Notify[],
    readonly child: ChildProcess,
    readonly dataDir: string,
    readonly token: string,
    readonly port: number,
    readonly controlPort: number,
  ) {
    child.once('exit', () => {
      this.exited = true;
    });
  }

  get base() {
    return `http://127.0.0.1:${this.port}`;
  }

  get alive() {
    return !this.exited;
  }

  /** 새 사이드카를 띄운다. dataDir을 주면 그 폴더(DB·키)를 이어 쓴다. 포트와 토큰은 늘 새로 정해진다. */
  static async start(dataDir?: string): Promise<Stack> {
    const dir = dataDir ?? mkdtempSync(join(tmpdir(), 'vater-accept-'));
    const token = randomBytes(32).toString('hex');
    const child = spawn('uv', ['run', '--project', SIDECAR, 'python', STACK_PY, dir, '0'], {
      env: { ...process.env, VATER_TOKEN: token },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true, // uv run → python 묶음째 끈다
    });
    child.stderr?.pipe(createWriteStream(join(dir, 'stack-stderr.log'), { flags: 'a' }));
    const notifies: Notify[] = [];
    const ready = await new Promise<{ port: number; control: number }>((ok, fail) => {
      const timer = setTimeout(
        () => fail(new Error('stack.py가 60초 안에 ready를 보내지 않았습니다')),
        60_000,
      );
      child.once('exit', (code) => fail(new Error(`stack.py가 끝났습니다(${String(code)})`)));
      // stdout은 셸 이벤트 통로: 끝까지 읽어야 파이프가 막히지 않는다
      createInterface({ input: child.stdout as NodeJS.ReadableStream }).on('line', (line) => {
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line) as Record<string, unknown>;
        } catch {
          return;
        }
        if (event.type === 'ready') {
          clearTimeout(timer);
          ok({ port: Number(event.port), control: Number(event.control) });
        } else if (event.type === 'notify') {
          notifies.push({
            at: Date.now(),
            title: String(event.title),
            body: String(event.body),
            route: typeof event.route === 'string' ? event.route : null,
          });
        }
      });
    });
    const stack = new Stack(notifies, child, dir, token, ready.port, ready.control);
    running.add(stack);
    return stack;
  }

  /** 사이드카 REST(토큰 포함). */
  api(path: string, init: RequestInit = {}) {
    return fetch(`${this.base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
  }

  async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.api(path, init);
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  /** 제어 서버: 가짜 한투·엔진·LLM을 조종한다. */
  async ctl(path: string, body: Record<string, unknown> = {}) {
    const res = await fetch(`http://127.0.0.1:${this.controlPort}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`control ${path}: HTTP ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }

  async state(): Promise<StackState> {
    const res = await fetch(`http://127.0.0.1:${this.controlPort}/state`);
    return (await res.json()) as StackState;
  }

  /** 가짜 키를 화면 밖에서 넣는다(마법사를 거치지 않는 테스트). */
  async setup(opts: { kis?: boolean; llm?: boolean } = { kis: true, llm: true }) {
    await this.ctl('/setup', opts);
  }

  /** 감시 종목 + 목표가 이상 규칙(실시간). */
  async watchAbove(code: string, price: number) {
    const item = await this.json<{ id: number }>('/watchlist', {
      method: 'POST',
      body: JSON.stringify({ market: 'KR', code }),
    });
    await this.json('/alerts/rules', {
      method: 'POST',
      body: JSON.stringify({
        watchlist_id: item.id,
        kind: 'price_above',
        params: { price },
        timing: 'realtime',
      }),
    });
    return item.id;
  }

  /** 가짜 한투 WebSocket에 이 종목 구독이 들어올 때까지 기다린다. */
  async waitSubscribed(code: string, timeoutMs = 20_000) {
    await expect
      .poll(async () => (await this.state()).subscribed.includes(code), { timeout: timeoutMs })
      .toBe(true);
  }

  /** 프로세스를 죽인다(기본 SIGKILL: 비정상 종료 흉내). */
  async kill(signal: NodeJS.Signals = 'SIGKILL') {
    if (this.exited) return;
    const done = new Promise<void>((r) => this.child.once('exit', () => r()));
    try {
      process.kill(-(this.child.pid ?? 0), signal);
    } catch {
      // 이미 끝남
    }
    await Promise.race([done, new Promise((r) => setTimeout(r, 5_000))]);
  }

  async stop() {
    running.delete(this);
    await this.kill('SIGTERM');
    if (!this.exited) await this.kill('SIGKILL');
  }
}

export async function stopAll(removeDirs: boolean) {
  const dirs = new Set<string>();
  for (const s of [...running]) {
    dirs.add(s.dataDir);
    await s.stop();
  }
  if (removeDirs) for (const d of dirs) rmSync(d, { recursive: true, force: true });
  return [...dirs];
}

export type ShellState = 'ready' | 'starting' | 'failed' | 'stopped';

export interface ShellCall {
  cmd: string;
  args: Record<string, unknown>;
  at: number;
}

/** 가짜 Tauri 셸: get_sidecar_info·get_autostart·set_autostart에 답하고 이벤트를 보낸다. */
export class FakeShell {
  state: ShellState = 'ready';
  autostart = false;
  readonly calls: ShellCall[] = [];
  private pages: Page[] = [];

  constructor(public stack: Stack | null) {}

  handle(cmd: string, args: Record<string, unknown>): unknown {
    this.calls.push({ cmd, args, at: Date.now() });
    switch (cmd) {
      case 'get_sidecar_info':
        if (this.state === 'ready' && this.stack) {
          return { state: 'ready', port: this.stack.port, token: this.stack.token };
        }
        return { state: this.state };
      case 'get_autostart':
        return this.autostart;
      case 'set_autostart':
        this.autostart = Boolean(args.enabled);
        return this.autostart;
      case 'open_log_folder':
        return null;
      default:
        throw new Error(`가짜 셸에 없는 커맨드: ${cmd}`);
    }
  }

  async attach(page: Page) {
    this.pages.push(page);
    await page.exposeBinding(
      '__vaterShell',
      (_source, cmd: string, args: Record<string, unknown>) => this.handle(cmd, args ?? {}),
    );
    await page.addInitScript(installFakeTauri);
  }

  /** 셸 이벤트(sidecar-state, navigate)를 화면에 보낸다. */
  async emit(event: 'sidecar-state' | 'navigate', payload: unknown) {
    for (const page of this.pages) {
      await page.evaluate(
        ([e, p]) =>
          (window as unknown as { __vaterEmit: (e: string, p: unknown) => void }).__vaterEmit(
            e as string,
            p,
          ),
        [event, payload] as const,
      );
    }
  }

  count(cmd: string) {
    return this.calls.filter((c) => c.cmd === cmd).length;
  }
}

/**
 * 화면 안에서 도는 가짜 Tauri 다리. `@tauri-apps/api` 2.x의 invoke·listen·isTauri가 쓰는 전역만 넣는다.
 * (addInitScript로 넘기므로 바깥 변수를 쓰면 안 된다)
 */
function installFakeTauri() {
  type Callback = (payload: unknown) => void;
  const w = window as unknown as Record<string, unknown>;
  const callbacks = new Map<number, Callback>();
  const listeners: { event: string; handler: number; id: number }[] = [];
  let next = 1;
  w.isTauri = true;
  w.__TAURI_INTERNALS__ = {
    transformCallback(callback: Callback, once = false) {
      const id = next++;
      callbacks.set(id, (payload) => {
        if (once) callbacks.delete(id);
        callback(payload);
      });
      return id;
    },
    unregisterCallback(id: number) {
      callbacks.delete(id);
    },
    async invoke(cmd: string, args: Record<string, unknown> = {}) {
      if (cmd === 'plugin:event|listen') {
        const id = next++;
        listeners.push({ event: String(args.event), handler: Number(args.handler), id });
        return id;
      }
      if (cmd === 'plugin:event|unlisten') {
        const i = listeners.findIndex((l) => l.id === Number(args.eventId));
        if (i >= 0) listeners.splice(i, 1);
        return null;
      }
      const shell = w.__vaterShell as (cmd: string, args: unknown) => Promise<unknown>;
      return shell(cmd, args);
    },
    convertFileSrc: (path: string) => path,
  };
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener(event: string, id: number) {
      const i = listeners.findIndex((l) => l.event === event && l.id === id);
      if (i >= 0) listeners.splice(i, 1);
    },
  };
  w.__vaterEmit = (event: string, payload: unknown) => {
    for (const l of [...listeners]) {
      if (l.event === event) callbacks.get(l.handler)?.({ event, id: l.id, payload });
    }
  };
}

export interface PageLog {
  /** 콘솔 오류와 잡히지 않은 예외. 브라우저가 4xx·5xx 응답마다 남기는 "Failed to load resource" 줄은
   * 화면이 처리하는 API 오류이므로 빼고 httpErrors에 따로 모은다. */
  errors: string[];
  httpErrors: string[];
  requests: Request[];
}

/** 화면 출처(tauri.localhost) → Vite 개발 서버. */
async function routeApp(page: Page) {
  await page.route(`${APP_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({
      url: `http://localhost:${VITE_PORT}${url.pathname}${url.search}`,
    });
    await route.fulfill({ response });
  });
  // Vite HMR: 열어 두기만 한다(가짜 서버, 메시지 없음)
  await page.routeWebSocket(/^ws:\/\/tauri\.localhost/, () => undefined);
}

export function watchPage(page: Page): PageLog {
  const log: PageLog = { errors: [], httpErrors: [], requests: [] };
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (/^Failed to load resource: the server responded with a status of \d+/.test(msg.text())) {
      return;
    }
    log.errors.push(msg.text());
  });
  page.on('response', (res) => {
    if (res.status() >= 400) {
      const url = new URL(res.url());
      log.httpErrors.push(`${res.status()} ${res.request().method()} ${url.pathname}`);
    }
  });
  page.on('pageerror', (e) => log.errors.push(`pageerror: ${e.message}`));
  page.on('request', (req) => log.requests.push(req));
  return log;
}

/** 사이드카로 간 요청(화면 → 127.0.0.1). */
export function sidecarRequests(log: PageLog) {
  return log.requests.filter((r) => r.url().startsWith('http://127.0.0.1:'));
}

interface Fixtures {
  stack: Stack;
  shell: FakeShell;
  log: PageLog;
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  stack: async ({}, provide, testInfo) => {
    const stack = await Stack.start();
    await provide(stack);
    const dirs = await stopAll(testInfo.status === testInfo.expectedStatus);
    if (testInfo.status !== testInfo.expectedStatus) {
      for (const d of dirs) {
        await testInfo
          .attach('stack-stderr', { path: join(d, 'stack-stderr.log') })
          .catch(() => undefined);
      }
    }
  },
  shell: async ({ stack, page }, provide) => {
    const shell = new FakeShell(stack);
    await routeApp(page);
    await shell.attach(page);
    await provide(shell);
  },
  log: async ({ page }, provide) => {
    await provide(watchPage(page));
  },
});

export { expect };

/** 화면 본문(사이드바·상태 표시줄 제외). */
export const main = (page: Page) => page.getByRole('main');

export async function openApp(page: Page, hash = '#/home') {
  await page.goto(`${APP_ORIGIN}/${hash}`);
}
