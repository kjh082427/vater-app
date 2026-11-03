/**
 * 흐름 테스트의 실제 구성: 개발 모드 사이드카(VATER_DEV=1) + Vite 개발 서버.
 * - 사이드카: 임시 데이터 폴더, 백그라운드 작업 끔(종목 마스터·한투 감시·브리핑 일정), 비밀키는 임시 env 파일
 *   (sidecar/tests/acceptance/test_process.py와 같은 방식). 종목은 seed.py로 심는다.
 * - Vite: VITE_SIDECAR_URL·VITE_SIDECAR_TOKEN으로 브라우저 플랫폼이 사이드카를 찾는다.
 * 실제 한투·LLM 키는 쓰지 않는다. 연결 테스트에는 가짜 키만 넣는다.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const DESKTOP = resolve(import.meta.dirname, '..');
const SIDECAR = resolve(DESKTOP, '../../sidecar');
export const STACK_FILE = join(tmpdir(), 'vater-e2e-stack.json');

export interface StackInfo {
  base: string;
  token: string;
  dataDir: string;
  sidecarPid: number;
  vitePid: number;
}

function waitForReady(child: ChildProcess): Promise<number> {
  return new Promise((resolvePort, reject) => {
    if (!child.stdout) {
      reject(new Error('사이드카 stdout이 없습니다'));
      return;
    }
    const lines = createInterface({ input: child.stdout });
    const timer = setTimeout(
      () => reject(new Error('사이드카가 30초 안에 ready를 보내지 않았습니다')),
      30_000,
    );
    let port = 0;
    // stdout은 이벤트 통로라 끝까지 읽어 줘야 파이프가 막히지 않는다
    lines.on('line', (line) => {
      if (port) return;
      try {
        const event = JSON.parse(line) as { type?: string; port?: number };
        if (event.type === 'ready' && event.port) {
          port = event.port;
          clearTimeout(timer);
          resolvePort(port);
        }
      } catch {
        // ready 전의 다른 줄은 무시
      }
    });
    child.once('exit', (code) => reject(new Error(`사이드카가 종료되었습니다(${String(code)})`)));
  });
}

async function waitForHttp(url: string, timeoutMs: number) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // 아직 안 떴다
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${url}이(가) ${timeoutMs}ms 안에 뜨지 않았습니다`);
}

export async function startStack(): Promise<StackInfo> {
  const dataDir = mkdtempSync(join(tmpdir(), 'vater-e2e-'));
  const envFile = join(dataDir, 'secrets.env');
  writeFileSync(envFile, '');
  const seeded = spawnSync(
    'uv',
    ['run', '--project', SIDECAR, 'python', join(DESKTOP, 'e2e/seed.py'), dataDir],
    {
      encoding: 'utf8',
    },
  );
  if (seeded.status !== 0) throw new Error(`종목 심기 실패: ${seeded.stderr}`);

  const token = randomBytes(24).toString('hex');
  const sidecar = spawn('uv', ['run', '--project', SIDECAR, 'python', '-m', 'vater_core'], {
    env: {
      ...process.env,
      VATER_TOKEN: token,
      VATER_DEV: '1',
      VATER_DATA_DIR: dataDir,
      VATER_BACKGROUND_JOBS: '0',
      VATER_SECRET_BACKEND: 'envfile',
      VATER_ENV_FILE: envFile,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
    detached: true, // 프로세스 묶음째 끄려고(uv run → python)
  });
  const port = await waitForReady(sidecar);
  const base = `http://127.0.0.1:${port}`;

  const vite = spawn('npx', ['vite', '--port', '5173', '--strictPort'], {
    cwd: DESKTOP,
    env: { ...process.env, VITE_SIDECAR_URL: base, VITE_SIDECAR_TOKEN: token },
    stdio: ['ignore', 'ignore', 'inherit'],
    detached: true,
  });
  await waitForHttp('http://localhost:5173/', 30_000);

  const info: StackInfo = {
    base,
    token,
    dataDir,
    sidecarPid: sidecar.pid ?? 0,
    vitePid: vite.pid ?? 0,
  };
  writeFileSync(STACK_FILE, JSON.stringify(info));
  return info;
}

export async function stopStack(info: StackInfo) {
  try {
    await fetch(`${info.base}/shutdown`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${info.token}` },
    });
  } catch {
    // 이미 꺼졌다
  }
  await new Promise((r) => setTimeout(r, 500));
  for (const pid of [info.vitePid, info.sidecarPid]) {
    try {
      if (pid) process.kill(-pid, 'SIGTERM'); // 프로세스 묶음
    } catch {
      // 이미 끝남
    }
  }
  rmSync(info.dataDir, { recursive: true, force: true });
  rmSync(STACK_FILE, { force: true });
}
