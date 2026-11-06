/**
 * v2 확인 V1~V10, V12(v2 설계 전체, 계획 `2026-11-05-v2-acceptance-release.md` Task 1). V11은 migrate.accept.ts.
 * 실제 사이드카(홀딩·포트폴리오·분류·브리핑 서비스, 어댑터 3개, DB)와 실제 화면이고, 증권사 서버 셋(한투·키움·메리츠)은
 * stack.py의 가짜 서버다(공식 형식 응답). 실제 증권사·AI·인터넷은 부르지 않고 키는 가짜 값뿐이다.
 *
 * 시계: 화 2026-11-03 16:00 KST(국내 장 마감 뒤)에서 실제 시간으로 흐른다. 국내 일봉 종가 = 현재가 + 일 × 100,
 * 미국 일봉 종가 = 현재가 + 일, 환율 = 1400 + 일(stack.py). 값은 이 규칙으로 직접 계산해 견준다.
 *
 * 보유 데이터(합계): 삼성전자 15주 평단 62,000(한투 10@60,000 + 키움 5@66,000), SK하이닉스 3주 평단 194,000
 * (한투 2@190,000 + 메리츠 1@202,000), 애플 2.5주 평단 195.2달러(한투 1.5@200 + 메리츠 1@188), NAVER 3주 평단 200,000(키움),
 * 엔비디아 2주 평단 100달러(키움), 토요타 100주(한투, 지원하지 않는 시장).
 */
import type { Locator, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, main, openApp, test, type Stack } from './harness';

const KIWOOM = {
  app_key: 'fake-kiwoom-key-0000000000',
  app_secret: 'fake-kiwoom-secret-1111111111',
};
const MERITZ = {
  app_key: 'fake-meritz-key-0000000000',
  app_secret: 'fake-meritz-secret-111111111',
};
const KIS_ACCOUNT = '12345678-01';
const SECRETS = [KIWOOM.app_key, KIWOOM.app_secret, MERITZ.app_key, MERITZ.app_secret];
const MINUS = '[-−]';

interface Conn {
  id: number;
  broker_id: string;
  account_mask: string;
  status: string;
  last_error: string | null;
}
interface SyncResult {
  connection_id: number;
  broker_id: string;
  ok: boolean;
  error: { code: string } | null;
}
interface Totals {
  value: number | null;
  cost: number | null;
  pl: number | null;
  pl_pct: number | null;
}
interface SymbolValue extends Totals {
  code: string;
  price: number | null;
  total: string;
  avg_price: number | null;
}
interface Summary {
  symbols: SymbolValue[];
  currencies: Record<string, Totals>;
  total_krw: Totals | null;
  usdkrw: number | null;
  missing_prices: number;
  unsupported: number;
}
interface Holding {
  broker_id: string;
  code: string;
  quantity: string;
  source: string;
  is_new: boolean;
  supported: boolean;
}
interface SymbolHoldings {
  total: string;
  avg_price: number | null;
  brokers: { broker_id: string; quantity: string; ratio: number; stale: boolean }[];
}
interface HistoryPoint {
  day: string;
  value: number | null;
  cost: number | null;
  usdkrw: number | null;
  backfilled: boolean;
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
const put = (body: unknown): RequestInit => ({ method: 'PUT', body: JSON.stringify(body) });

async function connect(stack: Stack, broker: 'kis' | 'kiwoom' | 'meritz') {
  const body =
    broker === 'kis'
      ? { broker_id: 'kis', account: KIS_ACCOUNT }
      : { broker_id: broker, ...(broker === 'kiwoom' ? KIWOOM : MERITZ) };
  return stack.json<Conn>('/connections', post(body));
}

async function saveManual(stack: Stack, body: Record<string, unknown>) {
  const res = await stack.api('/holdings/manual', put(body));
  expect(res.status).toBe(204);
}

const sync = (stack: Stack) => stack.json<SyncResult[]>('/holdings/sync', post({}));
const summary = (stack: Stack) => stack.json<Summary>('/portfolio/summary');
const price = (stack: Stack, code: string, value: number) =>
  stack.ctl('/price', { code, price: value, change: 0, pct: 0 });

/** 키·가짜 키 입력과 화면 밖 설정을 끝내고 세 증권사를 연결해 한 번 갱신한다. */
async function holdAll(stack: Stack) {
  await stack.setup();
  await price(stack, '035420', 210_000);
  await price(stack, 'NVDA', 130);
  for (const b of ['kis', 'kiwoom', 'meritz'] as const) await connect(stack, b);
  const results = await sync(stack);
  expect(results.map((r) => r.ok)).toEqual([true, true, true]);
}

const near = (actual: number | null | undefined, expected: number, digits = 4) =>
  expect(actual ?? Number.NaN).toBeCloseTo(expected, digits);

/** 국내 일봉 종가 합(stack.py kr_close): 현재가 + 일 × 100. 삼성전자 15, SK하이닉스 3, NAVER 3주. */
const krValue = (day: number) =>
  15 * (59_000 + day * 100) + 3 * (198_500 + day * 100) + 3 * (210_000 + day * 100);
/** 미국 일봉 종가 합(stack.py us_close): 현재가 + 일. 애플 2.5주, 엔비디아 2주. */
const usValue = (day: number) => 2.5 * (227.48 + day) + 2 * (130 + day);
const fx = (day: number) => 1400 + day;

function asset(page: Page, name: string): Locator {
  return page.getByRole('region', { name });
}

async function pickBroker(card: Locator, page: Page, name: string) {
  await card.getByRole('button', { name: '연결 추가' }).click();
  await card.getByRole('button', { name: /^증권사 / }).click();
  await page.getByRole('option', { name, exact: true }).click();
}

async function goto(page: Page, hash: string) {
  await page.evaluate((h) => {
    window.location.hash = h;
  }, hash);
}

test('V1 연결 → 업로드 → 체크 해제: 세 증권사를 화면에서 연결하고 보유를 올리되 체크 끊은 종목은 올리지 않는다', async ({
  page,
  stack,
  shell,
  log,
}) => {
  void shell;
  await stack.setup();
  await price(stack, '035420', 210_000);
  await openApp(page, '#/settings');
  const card = asset(page, '증권사 연결');

  await test.step('연결: 한국투자(계좌번호) · 키움 · 메리츠(키). 키는 다시 보이지 않는다', async () => {
    await pickBroker(card, page, '한국투자');
    await card.getByLabel('계좌번호').fill(KIS_ACCOUNT);
    await card.getByRole('button', { name: '연결', exact: true }).click();
    for (const [name, keys] of [
      ['키움', KIWOOM],
      ['메리츠', MERITZ],
    ] as const) {
      await expect(card.getByRole('button', { name: '연결 추가' })).toBeVisible();
      await pickBroker(card, page, name);
      await card.getByLabel('앱키').fill(keys.app_key);
      await card.getByLabel('앱시크릿').fill(keys.app_secret);
      await card.getByRole('button', { name: '연결', exact: true }).click();
    }
    const list = card.getByRole('list', { name: '연결한 증권사' });
    await expect(list.getByRole('listitem')).toHaveCount(3);
    await expect(list.getByText('****7801')).toBeVisible();
    await expect(list.getByText(/^키 [0-9a-f]{4}$/)).toHaveCount(2);
    await expect(list.getByText('연결됨')).toHaveCount(3);
    for (const secret of SECRETS) await expect(page.locator('body')).not.toContainText(secret);
  });

  await test.step('어댑터는 공식 목록의 조회만 부른다(키움 kt00018·ust21070, 메리츠 holdings, 한투 잔고)', async () => {
    const state = await stack.state();
    expect(new Set(state.broker_calls.kiwoom)).toEqual(
      new Set(['POST /oauth2/token', 'POST /api/dostk/acnt', 'POST /api/us/acnt']),
    );
    expect(new Set(state.broker_calls.meritz)).toEqual(
      new Set([
        'POST /oauth2/token',
        'GET /accounts/v1/me/holdings',
        'GET /accounts/v1/me/overseas/holdings',
      ]),
    );
    const trading = new Set(state.rest_paths.filter((p) => p.includes('/trading/')));
    expect(trading).toEqual(
      new Set([
        '/uapi/domestic-stock/v1/trading/inquire-balance',
        '/uapi/overseas-stock/v1/trading/inquire-present-balance',
      ]),
    );
  });

  await test.step('업로드: 모두 갱신 → 새 종목 5개, 지원하지 않는 시장은 막힘, 엔비디아 체크 해제', async () => {
    await goto(page, '#/alerts');
    await page.getByRole('button', { name: '연결한 증권사 모두' }).click();
    const dialog = page.getByRole('dialog', { name: /보유 종목 올리기/ });
    for (const name of ['삼성전자', 'SK하이닉스', '애플', 'NAVER', '엔비디아']) {
      await expect(dialog.getByRole('checkbox', { name: new RegExp(name) })).toBeChecked();
    }
    await expect(dialog.getByRole('checkbox', { name: /토요타/ })).toBeDisabled();
    await expect(dialog.getByText('국내·미국 외 시장은 지원하지 않습니다.')).toBeVisible();
    await expect(dialog.getByText('감시 종목은 브리핑 작성 때 AI로 전송됩니다.')).toBeVisible();
    await dialog.getByRole('checkbox', { name: /엔비디아/ }).uncheck();
    await dialog.getByRole('button', { name: /감시 종목에 올리기/ }).click();
    await expect(page.getByText(/4종목을 감시 종목에 올렸습니다/)).toBeVisible();
    await expect(page.getByText(/새 종목 \d/)).toHaveCount(0);
  });

  await test.step('결과: 감시 종목은 체크한 4개, 보유 내역은 전부 저장, 엔비디아는 다시 새 종목으로 세지 않는다', async () => {
    const watch = await stack.json<{ code: string }[]>('/watchlist');
    expect(watch.map((w) => w.code).sort()).toEqual(['000660', '005930', '035420', 'AAPL']);
    const held = await stack.json<Holding[]>('/holdings');
    expect(held).toHaveLength(9);
    expect(held.filter((h) => h.code === 'NVDA').map((h) => h.is_new)).toEqual([false]);
    expect(held.find((h) => h.code === '7203')?.supported).toBe(false);
    await expect(page.getByRole('button', { name: /^엔비디아/ })).toHaveCount(0);
    expect((await stack.state()).broker_calls.kiwoom.some((c) => c.startsWith('UNEXPECTED'))).toBe(
      false,
    );
  });
  expect(log.errors).toEqual([]);
});

test('V2 같은 종목 합산·토글: 증권사 셋의 같은 종목은 한 줄, 칩은 수량과 비중으로 바뀌고 기억한다', async ({
  page,
  stack,
  shell,
  log,
}) => {
  void shell;
  await holdAll(stack);
  for (const code of ['005930', '000660']) {
    await stack.json('/watchlist', post({ market: 'KR', code }));
  }
  await stack.json('/watchlist', post({ market: 'US', code: 'AAPL' }));

  // API: 평단가는 수량 가중 평균
  const kr = await stack.json<SymbolHoldings>('/holdings/symbol/KR/005930');
  expect(kr.total).toBe('15');
  near(kr.avg_price, 62_000);
  const hynix = await stack.json<SymbolHoldings>('/holdings/symbol/KR/000660');
  expect(hynix.total).toBe('3');
  near(hynix.avg_price, 194_000);
  const aapl = await stack.json<SymbolHoldings>('/holdings/symbol/US/AAPL');
  expect(aapl.total).toBe('2.5');
  near(aapl.avg_price, 195.2);
  // 감시 종목은 한 종목에 한 줄이다(보유가 증권사마다 있어도)
  expect((await stack.json<{ code: string }[]>('/watchlist')).map((w) => w.code).sort()).toEqual([
    '000660',
    '005930',
    'AAPL',
  ]);

  await openApp(page, '#/symbols/KR/005930');
  const holding = asset(page, '내 보유');
  await expect(holding.getByText('총 15주 · 평단가 62,000원')).toBeVisible();
  await expect(holding.getByRole('button', { name: '한국투자 10주' })).toBeVisible();
  await expect(holding.getByRole('button', { name: '키움 5주' })).toBeVisible();
  await expect(holding.getByRole('button', { name: /메리츠/ })).toHaveCount(0);

  await holding.getByRole('button', { name: '한국투자 10주' }).click();
  await expect(holding.getByRole('button', { name: '한국투자 66.7%' })).toBeVisible();
  await expect(holding.getByRole('button', { name: '키움 33.3%' })).toBeVisible();
  // 화면을 떠났다 돌아와도 비중 보기를 기억한다
  await goto(page, '#/alerts');
  await expect(page.getByRole('button', { name: '연결한 증권사 모두' })).toBeVisible();
  await goto(page, '#/symbols/KR/005930');
  await expect(asset(page, '내 보유').getByRole('button', { name: '키움 33.3%' })).toBeVisible();

  // 두 증권사에 걸친 미국 종목: 소수 수량도 그대로
  await goto(page, '#/symbols/US/AAPL');
  const us = asset(page, '내 보유');
  await expect(us.getByText(/^총 2\.5주 · 평단가 /)).toBeVisible();
  await expect(us.getByRole('button', { name: /^한국투자 (1\.5주|60\.0%)$/ })).toBeVisible();
  await expect(us.getByRole('button', { name: /^메리츠 (1주|40\.0%)$/ })).toBeVisible();
  expect(log.errors).toEqual([]);
});

test('V3 평가금액·손익: 종목별과 통화별 합계, 시세 없는 종목은 합계에서 빼고 알린다, 환율로 원화 환산', async ({
  page,
  stack,
  shell,
  log,
}) => {
  void shell;
  await stack.setup();
  await price(stack, '035420', 210_000);
  await price(stack, 'NVDA', 0); // 시세가 없다는 뜻이다. 평가금액을 0으로 만들지 않는다
  for (const b of ['kis', 'kiwoom', 'meritz'] as const) await connect(stack, b);
  await sync(stack);
  for (const code of ['005930', '000660']) {
    await stack.json('/watchlist', post({ market: 'KR', code }));
  }

  let s = await summary(stack);
  const by = (code: string) => s.symbols.find((x) => x.code === code) as SymbolValue;
  near(by('005930').value, 885_000);
  near(by('005930').cost, 930_000);
  near(by('005930').pl, -45_000);
  near(by('005930').pl_pct, (-45_000 / 930_000) * 100);
  near(by('000660').pl, 13_500);
  near(by('035420').pl, 30_000);
  near(by('AAPL').value, 568.7);
  near(by('AAPL').pl, 80.7);
  expect(by('NVDA')).toMatchObject({ price: null, value: null, pl: null });
  expect(s.missing_prices).toBe(1);
  expect(s.unsupported).toBe(1);
  near(s.currencies.KRW?.value, 2_110_500);
  near(s.currencies.KRW?.pl, -1_500);
  near(s.currencies.USD?.value, 568.7); // 엔비디아는 빠진다
  expect(s.usdkrw).toBe(1403);
  near(s.total_krw?.value, 2_110_500 + 568.7 * 1403);

  // 화면: 종목 화면의 내 보유 카드
  await openApp(page, '#/symbols/KR/005930');
  const card = asset(page, '내 보유');
  await expect(card.getByText('885,000원')).toBeVisible();
  await expect(
    card.getByText(new RegExp(`^${MINUS}45,000원 \\(${MINUS}4\\.84%\\)$`)),
  ).toBeVisible();
  await goto(page, '#/symbols/KR/000660');
  await expect(asset(page, '내 보유').getByText('595,500원')).toBeVisible();
  await expect(asset(page, '내 보유').getByText(/^\+13,500원 \(\+2\.32%\)$/)).toBeVisible();

  // 화면: 대시보드에서 내 보유 종목 칸이 시세 없는 종목을 알린다
  await goto(page, '#/home');
  await page.getByRole('button', { name: '배치 편집' }).click();
  await page.getByRole('button', { name: '칸 3 내용 바꾸기' }).click();
  await page
    .getByRole('dialog', { name: '칸 3에 보여 줄 내용' })
    .getByRole('button', { name: /^내 보유 종목/ })
    .click();
  await page.getByRole('button', { name: '저장' }).click();
  const tile = asset(page, '칸 3: 내 보유 종목');
  await expect(tile.getByRole('row', { name: /삼성전자/ })).toBeVisible();
  await expect(tile.getByRole('row', { name: /엔비디아/ })).toBeVisible();

  // 시세가 돌아오면 합계에 들어온다(실패는 저장하지 않으므로 바로 다시 받는다)
  await price(stack, 'NVDA', 130);
  s = await summary(stack);
  expect(s.missing_prices).toBe(0);
  near(by('NVDA').value, 260);
  near(s.currencies.USD?.value, 828.7);
  near(s.currencies.USD?.pl, 140.7);
  near(s.total_krw?.value, 2_110_500 + 828.7 * 1403);
  expect(log.errors).toEqual([]);
});

test('V4 주기 설정: 화면에서 주가 30초·보유 30분으로 바꾸면 저장되고 새로 열어도 남고, 주가 주기가 시세 재조회에 쓰인다', async ({
  page,
  stack,
  shell,
  log,
}) => {
  test.setTimeout(150_000);
  void shell;
  await holdAll(stack);
  await openApp(page, '#/settings');
  const general = asset(page, '일반');
  await expect(general.getByRole('button', { name: /^주가 갱신 주기/ })).toContainText('10분');
  await expect(general.getByRole('button', { name: /^보유 수량 갱신 주기/ })).toContainText('끔');
  await general.getByRole('button', { name: /^주가 갱신 주기/ }).click();
  await page.getByRole('option', { name: '30초' }).click();
  await general.getByRole('button', { name: /^보유 수량 갱신 주기/ }).click();
  await page.getByRole('option', { name: '30분' }).click();
  await expect
    .poll(async () => {
      const s = await stack.json<Record<string, unknown>>('/settings');
      return [s['quotes.refresh_sec'], s['holdings.sync_minutes']];
    })
    .toEqual([30, 30]);
  await page.reload();
  const again = asset(page, '일반');
  await expect(again.getByRole('button', { name: /^주가 갱신 주기/ })).toContainText('30초');
  await expect(again.getByRole('button', { name: /^보유 수량 갱신 주기/ })).toContainText('30분');

  // 주기 안에서는 받아 둔 시세를 쓰고, 주기가 지나면 다시 받는다
  const first = await summary(stack);
  near(first.symbols.find((x) => x.code === '005930')?.price, 59_000);
  await price(stack, '005930', 61_000);
  const cached = await summary(stack);
  near(cached.symbols.find((x) => x.code === '005930')?.price, 59_000);
  await page.waitForTimeout(31_000);
  const fresh = await summary(stack);
  near(fresh.symbols.find((x) => x.code === '005930')?.price, 61_000);
  expect(log.errors).toEqual([]);
});

test('V5 끊김·해제·삭제: 한 증권사의 실패는 그 연결에서 끝나고, 해제는 키를 지우며 데이터는 사용자가 고른다', async ({
  page,
  stack,
  shell,
  log,
}) => {
  void shell;
  await holdAll(stack);
  const secretsFile = () => readFileSync(join(stack.dataDir, 'secrets.env'), 'utf8');
  for (const secret of SECRETS) expect(secretsFile()).toContain(secret); // 검사가 헛돌지 않는다

  await test.step('메리츠 서버 오류와 키움 인증 실패: 다른 연결은 갱신되고, 수량은 지워지지 않는다', async () => {
    await stack.ctl('/broker', { broker: 'meritz', mode: 'down' });
    await stack.ctl('/broker', { broker: 'kiwoom', mode: 'auth' });
    const results = await sync(stack);
    const code = (b: string) => results.find((r) => r.broker_id === b);
    expect(code('kis')?.ok).toBe(true);
    expect(code('meritz')).toMatchObject({ ok: false, error: { code: 'BROKER_UNREACHABLE' } });
    expect(code('kiwoom')).toMatchObject({ ok: false, error: { code: 'BROKER_AUTH_INVALID' } });
    const conns = await stack.json<Conn[]>('/connections');
    const status = (b: string) => conns.find((c) => c.broker_id === b)?.status;
    expect([status('kis'), status('kiwoom'), status('meritz')]).toEqual(['ok', 'lost', 'ok']);
    expect(conns.find((c) => c.broker_id === 'kiwoom')?.last_error).toBe('BROKER_AUTH_INVALID');
    const kr = await stack.json<SymbolHoldings>('/holdings/symbol/KR/005930');
    expect(kr.total).toBe('15');
    expect(kr.brokers.find((b) => b.broker_id === 'kiwoom')?.stale).toBe(true);
    expect(kr.brokers.find((b) => b.broker_id === 'kis')?.stale).toBe(false);
  });

  await test.step('화면: 키움 끊김 안내와 저장된 수량 유지 문구', async () => {
    await openApp(page, '#/settings');
    const card = asset(page, '증권사 연결');
    await expect(card.getByText('키움 연결이 끊겼습니다')).toBeVisible();
    await expect(card.getByText(/저장된 수량은 마지막 갱신 .*까지 유지됩니다/)).toBeVisible();
    await expect(card.getByRole('button', { name: '다시 연결' })).toBeVisible();
  });

  await test.step('메리츠 해제(데이터 유지): 키는 지우고 수량은 "연결 해제됨"으로 합계에 남는다', async () => {
    await stack.ctl('/broker', { broker: 'meritz', mode: 'ok' });
    await page.reload();
    const card = asset(page, '증권사 연결');
    await card.getByRole('button', { name: /^메리츠 키 [0-9a-f]{4} 연결 해제$/ }).click();
    const dialog = page.getByRole('dialog', { name: '메리츠 연결 해제' });
    await expect(dialog.getByText(/기존 데이터를 삭제할까요/)).toBeVisible();
    await dialog.getByRole('button', { name: '데이터 유지' }).click();
    await expect(card.getByText('연결 해제됨')).toBeVisible();
    expect(secretsFile()).not.toContain(MERITZ.app_key);
    expect(secretsFile()).not.toContain(MERITZ.app_secret);
    const hynix = await stack.json<SymbolHoldings>('/holdings/symbol/KR/000660');
    expect(hynix.total).toBe('3');
    expect(hynix.brokers.find((b) => b.broker_id === 'meritz')?.stale).toBe(true);
    const before = (await stack.state()).broker_calls.meritz.length;
    await sync(stack);
    expect((await stack.state()).broker_calls.meritz).toHaveLength(before); // 해제된 연결은 부르지 않는다
  });

  await test.step('데이터 삭제: 해제된 메리츠와 끊긴 키움의 수량이 합계에서 빠진다', async () => {
    const card = asset(page, '증권사 연결');
    const remove = (broker: string) =>
      card
        .getByRole('listitem')
        .filter({ hasText: broker })
        .getByRole('button', { name: '데이터 삭제' });
    await remove('메리츠').click();
    const gone = page.getByRole('dialog', { name: /데이터 삭제$/ });
    await gone.getByRole('button', { name: '삭제', exact: true }).click();
    await expect.poll(async () => (await stack.json<Conn[]>('/connections')).length).toBe(2);
    const hynix = await stack.json<SymbolHoldings>('/holdings/symbol/KR/000660');
    expect(hynix.total).toBe('2'); // 메리츠 1주가 빠졌다
    // 끊긴 키움도 데이터 삭제
    await remove('키움').click();
    await page
      .getByRole('dialog', { name: /데이터 삭제$/ })
      .getByRole('button', { name: '삭제', exact: true })
      .click();
    await expect.poll(async () => (await stack.json<Conn[]>('/connections')).length).toBe(1);
    expect((await stack.json<SymbolHoldings>('/holdings/symbol/KR/005930')).total).toBe('10');
    expect((await stack.json<Holding[]>('/holdings')).map((h) => h.broker_id)).not.toContain(
      'kiwoom',
    );
    expect(secretsFile()).not.toContain(KIWOOM.app_key);
    // 한투(남은 연결)는 계속 동작한다
    expect((await sync(stack)).map((r) => r.ok)).toEqual([true]);
  });
  expect(log.errors).toEqual([]);
});

test('V6 수동·CSV: 수동 입력과 CSV 가져오기가 합계에 들어가고, 연결된 증권사는 직접 입력을 막는다', async ({
  page,
  stack,
  shell,
  log,
}) => {
  void shell;
  await holdAll(stack);
  await stack.json('/watchlist', post({ market: 'KR', code: '005930' }));

  // 수동(삼성): 평단가 있는 수량
  await saveManual(stack, {
    broker_id: 'samsung',
    market: 'KR',
    code: '005930',
    quantity: '4',
    avg_price: 58_000,
  });
  let kr = await stack.json<SymbolHoldings>('/holdings/symbol/KR/005930');
  expect(kr.total).toBe('19');
  near(kr.avg_price, (930_000 + 4 * 58_000) / 19);
  // 연결된 증권사는 직접 입력할 수 없다
  const blocked = await stack.api(
    '/holdings/manual',
    put({
      broker_id: 'kiwoom',
      market: 'KR',
      code: '005930',
      quantity: '1',
      avg_price: 1,
    }),
  );
  expect(blocked.status).toBe(422);
  // 알 수 없는 종목은 저장하지 않는다
  const unknown = await stack.api(
    '/holdings/manual',
    put({
      broker_id: 'samsung',
      market: 'KR',
      code: '123123',
      quantity: '1',
      avg_price: 1,
    }),
  );
  expect(unknown.ok).toBe(false);

  // CSV(미래에셋): 열 이름을 추정하고 틀린 행을 알린다
  const csv =
    '종목명,종목코드,수량,평균단가\n삼성전자,005930,3,70000\n엔비디아,NVDA,2,110\n없는종목,000000,1,1\n';
  const preview = await stack.json<{
    columns: string[];
    guess: { code: string | null; quantity: string | null };
    rows: { code: string | null; error: string | null }[];
    changes: { added: number; updated: number; removed: number };
  }>('/holdings/csv/preview?broker_id=mirae', {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv' },
    body: csv,
  });
  expect(preview.columns).toEqual(['종목명', '종목코드', '수량', '평균단가']);
  expect(preview.guess).toMatchObject({ code: '종목코드', quantity: '수량' });
  expect(preview.rows.map((r) => r.error === null)).toEqual([true, true, false]);
  const commit = (rows: unknown[]) =>
    stack.json<{ added: number; updated: number; removed: number }>(
      '/holdings/csv/commit',
      post({ broker_id: 'mirae', rows }),
    );
  const both = [
    { market: 'KR', code: '005930', quantity: '3', avg_price: 70_000 },
    { market: 'US', code: 'NVDA', quantity: '2', avg_price: 110 },
  ];
  expect(await commit(both)).toEqual({ added: 2, updated: 0, removed: 0 });
  kr = await stack.json<SymbolHoldings>('/holdings/symbol/KR/005930');
  expect(kr.total).toBe('22');
  expect(kr.brokers.map((b) => b.broker_id).sort()).toEqual(['kis', 'kiwoom', 'mirae', 'samsung']);
  expect((await stack.json<SymbolHoldings>('/holdings/symbol/US/NVDA')).total).toBe('4');
  const held = await stack.json<Holding[]>('/holdings');
  expect(held.filter((h) => h.broker_id === 'mirae').map((h) => h.source)).toEqual(['csv', 'csv']);
  expect(held.find((h) => h.broker_id === 'samsung')?.source).toBe('manual');
  // 같은 종목이 두 번 있거나 비어 있으면 아무것도 바꾸지 않는다
  const dup = await stack.api(
    '/holdings/csv/commit',
    post({ broker_id: 'mirae', rows: [...both, both[0]] }),
  );
  expect(dup.status).toBe(422);
  expect(
    (await stack.api('/holdings/csv/commit', post({ broker_id: 'mirae', rows: [] }))).status,
  ).toBe(422);
  // 다시 가져오면 파일에 없는 수동 항목은 지워진다(변경 수를 미리 알린다)
  expect(await commit([both[0]])).toEqual({ added: 0, updated: 1, removed: 1 });
  expect((await stack.json<SymbolHoldings>('/holdings/symbol/US/NVDA')).total).toBe('2');

  // 화면: 수동·CSV 증권사도 칩으로 보인다
  await openApp(page, '#/symbols/KR/005930');
  const card = asset(page, '내 보유');
  await expect(card.getByText(/^총 22주/)).toBeVisible();
  await expect(card.getByRole('button', { name: '삼성 4주' })).toBeVisible();
  await expect(card.getByRole('button', { name: '미래에셋 3주' })).toBeVisible();
  expect(log.errors).toEqual([]);
});

test('V7 분류 탐색: 대분류 → 중분류, 시장(통합·한국·미국)을 바꿔도 분류가 유지되고, 미분류와 검색, 선택하면 감시에 올린다', async ({
  page,
  stack,
  shell,
  log,
}) => {
  void shell;
  await stack.setup();
  await openApp(page, '#/alerts');
  await page.getByRole('button', { name: '종목 추가' }).click();
  await page.getByRole('button', { name: '분류로 찾기' }).click();
  const names = (list: Locator) =>
    list.getByRole('listitem').evaluateAll((els) => els.map((e) => e.textContent ?? ''));
  const stocks = page.getByRole('list', { name: '분류의 종목' });
  const has = async (...want: string[]) => {
    const text = (await names(stocks)).join('|');
    for (const w of want) expect(text).toContain(w);
    return (await names(stocks)).length;
  };

  await page
    .getByRole('group', { name: '대분류' })
    .getByRole('button', { name: 'IT', exact: true })
    .click();
  await page
    .getByRole('group', { name: 'IT의 중분류' })
    .getByRole('button', { name: '반도체' })
    .click();
  // 통합: 한국 둘 + 미국 둘
  await expect(stocks.getByRole('listitem')).toHaveCount(4);
  await has('삼성전자', 'SK하이닉스', '엔비디아', 'AMD');
  const market = page.getByRole('radiogroup', { name: '시장' });
  await market.getByRole('radio', { name: '한국' }).check();
  await expect(stocks.getByRole('listitem')).toHaveCount(2);
  await has('삼성전자', 'SK하이닉스');
  await market.getByRole('radio', { name: '미국' }).check();
  await expect(stocks.getByRole('listitem')).toHaveCount(2);
  await has('엔비디아', 'AMD');
  await expect(
    page.getByRole('group', { name: 'IT의 중분류' }).getByRole('button', { name: '반도체' }),
  ).toHaveAttribute('aria-pressed', 'true'); // 시장을 바꿔도 고른 분류는 그대로
  await market.getByRole('radio', { name: '통합' }).check();

  // 대분류에서 멈춰도 그 아래 종목을 모두: IT = 반도체 4 + 인터넷(NAVER, 알파벳) + IT 하드웨어(애플)
  await page
    .getByRole('group', { name: '대분류' })
    .getByRole('button', { name: 'IT', exact: true })
    .click();
  await expect(stocks.getByRole('listitem')).toHaveCount(7);
  await has('NAVER', '알파벳', '애플');
  // 미분류
  await page.getByRole('group', { name: '대분류' }).getByRole('button', { name: '미분류' }).click();
  await expect(stocks.getByRole('listitem')).toHaveCount(1);
  await has('가상기업');
  // 검색: 테마 이름과 키워드(HBM)
  await page.getByRole('searchbox', { name: '분류 검색' }).fill('HBM');
  await expect(page.getByRole('list', { name: '찾은 분류' }).getByText(/반도체/)).toBeVisible();

  // API와 같은 수
  const api = await stack.json<{ code: string }[]>(
    '/categories/stocks?node=semiconductor&market=ALL',
  );
  expect(api.map((s) => s.code).sort()).toEqual(['000660', '005930', 'AMD', 'NVDA']);

  // 분류에서 고른 종목은 감시 종목이 된다
  await page.getByRole('searchbox', { name: '분류 검색' }).fill('');
  await page
    .getByRole('group', { name: '대분류' })
    .getByRole('button', { name: 'IT', exact: true })
    .click();
  await page
    .getByRole('group', { name: 'IT의 중분류' })
    .getByRole('button', { name: '반도체' })
    .click();
  await page.getByRole('button', { name: '엔비디아 추가' }).click();
  await expect(page).toHaveURL(/#\/symbols\/US\/NVDA$/);
  expect((await stack.json<{ code: string }[]>('/watchlist')).map((w) => w.code)).toEqual(['NVDA']);
  expect(log.errors).toEqual([]);
});

/** 대시보드에 자산 추이 칸을 넣는다(칸 4). */
async function addTrendTile(page: Page) {
  await openApp(page, '#/home');
  await page.getByRole('button', { name: '배치 편집' }).click();
  await page.getByRole('button', { name: '칸 4 내용 바꾸기' }).click();
  await page
    .getByRole('dialog', { name: '칸 4에 보여 줄 내용' })
    .getByRole('button', { name: /^자산 추이/ })
    .click();
  await page.getByRole('button', { name: '저장' }).click();
  return asset(page, '칸 4: 자산 추이');
}

test('V8 자산 추이: 꺼져 있던 날은 종가로 채우고(속이 빈 점), 환율이 없으면 원화·달러 보기만 보이다가 환율이 오면 재시도로 채운다', async ({
  page,
  stack,
  shell,
  log,
}) => {
  void shell;
  await holdAll(stack);
  const trend = (view: 'all' | 'krw' | 'usd') =>
    stack.json<HistoryPoint[]>(`/portfolio/history?range=all&view=${view}`);

  // 10/28(수)까지만 기록되어 있다. 그 뒤 29, 30일, 11/2(월), 오늘 11/3(화)은 앱이 꺼져 있었다. 환율은 못 받는다
  await stack.ctl('/fx', { off: true });
  await stack.ctl('/daily/seed', {
    day: '2026-10-28',
    kr_value: 2_000_000,
    kr_cost: 2_112_000,
    us_value: 800,
    us_cost: 688,
    usdkrw: 1428,
  });
  await stack.ctl('/daily/check');

  await test.step('빈 날을 그날 종가와 지금 수량으로 채운다(오늘 행은 채운 것이 아니다)', async () => {
    const krw = await trend('krw');
    expect(krw.map((p) => p.day)).toEqual([
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-11-02',
      '2026-11-03',
    ]);
    expect(krw.map((p) => p.backfilled)).toEqual([false, true, true, true, false]);
    for (const p of krw.slice(1)) near(p.value, krValue(Number(p.day.slice(8))), 2);
    near(krw[4]?.cost, 2_112_000, 2);
    // 미국 행은 전 거래일 종가: 29일 → 28일, 30일 → 29일, 11/2(월) → 30일, 11/3 → 2일
    const usd = await trend('usd');
    [28, 29, 30, 2].forEach((d, i) => near(usd[i + 1]?.value, usValue(d), 2));
  });

  await test.step('환율이 없으면 전체 보기는 비고(값을 지어내지 않는다) 원화·달러 보기는 그대로다', async () => {
    const all = await trend('all');
    expect(all.map((p) => p.value === null)).toEqual([false, true, true, true, true]);
    expect(all[0]?.value).toBeCloseTo(2_000_000 + 800 * 1428, 2);
    expect((await summary(stack)).total_krw).toBeNull();
    const tile = await addTrendTile(page);
    await expect(
      tile.getByText(/^환율 없음: 전체\(원화 환산\) 보기를 계산하지 못했습니다/),
    ).toBeVisible();
    await expect(
      tile.getByText(
        '채운 날 3일: 앱이 꺼져 있어 마지막 보유 수량과 그날 종가로 채웠습니다(속이 빈 점).',
      ),
    ).toBeVisible();
    await expect(tile.getByRole('img', { name: /주식 평가금액과 매입금액/ })).toBeVisible();
  });

  await test.step('환율이 돌아오고 재시도 시각이 지나면 그날 환율로 채운다', async () => {
    await stack.ctl('/fx', { off: false });
    await stack.ctl('/skew', { minutes: 31 });
    await stack.ctl('/daily/check');
    const all = await trend('all');
    expect(all.every((p) => p.value !== null)).toBe(true);
    const day = (p: HistoryPoint) => Number(p.day.slice(8));
    const session = (d: number) => ({ 29: 28, 30: 29, 2: 30, 3: 2 })[d] as number;
    for (const p of all.slice(1)) {
      expect(p.usdkrw).toBe(fx(day(p)));
      near(p.value, krValue(day(p)) + usValue(session(day(p))) * fx(day(p)), 1);
    }
    expect(all[0]?.usdkrw).toBe(1428); // 이미 기록한 값은 바꾸지 않는다
    expect(all.slice(1).map((p) => p.backfilled)).toEqual([true, true, true, false]);
    const s = await summary(stack);
    expect(s.usdkrw).toBe(1403);
    expect(s.total_krw).not.toBeNull();
    await page.reload();
    const tile = asset(page, '칸 4: 자산 추이');
    await expect(tile.getByText(/^환율 없음/)).toHaveCount(0);
    await expect(tile.getByText(/^적용 환율 1,403원 · 미국 비중 /)).toBeVisible();
  });
  expect(log.errors).toEqual([]);
});

test('V9 평단가 알림: 평단가 대비 -10% 규칙이 실시간으로 울리고, 알림 글과 셸 알림에 평단가·수량이 없다', async ({
  page,
  stack,
  shell,
  log,
}) => {
  void shell;
  await holdAll(stack);
  // 업로드 확인 창과 같은 경로: 체크한 종목에 규칙을 일괄 적용(삼성전자만)
  const added = await stack.json<{ added: number; rules: number }>(
    '/holdings/watch',
    post({
      items: [{ market: 'KR', code: '005930' }],
      rule: { kind: 'avg_price_pct', params: { pct: 10, direction: 'down' } },
    }),
  );
  expect(added).toMatchObject({ added: 1, rules: 1 });
  const rules = await stack.json<{ kind: string; timing: string }[]>('/alerts/rules');
  expect(rules.map((r) => [r.kind, r.timing])).toEqual([['avg_price_pct', 'realtime']]);
  // 목표가 규칙은 일괄 적용할 수 없다
  const bulk = await stack.api(
    '/holdings/watch',
    post({
      items: [{ market: 'KR', code: '000660' }],
      rule: { kind: 'price_above', params: { price: 1 } },
    }),
  );
  expect(bulk.status).toBe(422);

  await openApp(page, '#/home');
  await stack.waitSubscribed('005930');
  await expect(
    main(page)
      .getByRole('table', { name: '감시 종목' })
      .getByRole('row', { name: /삼성전자/ })
      .getByText('실시간', { exact: true }),
  ).toBeVisible({ timeout: 25_000 });
  await stack.ctl('/tick', { code: '005930', price: 60_000, pct: 0 }); // 평단가(62,000) 대비 -3.2%: 아직
  await page.waitForTimeout(1_300);
  await stack.ctl('/tick', { code: '005930', price: 55_000, pct: -8 }); // -11.29%
  await expect
    .poll(async () => (await stack.json<unknown[]>('/alerts/events')).length, { timeout: 8_000 })
    .toBe(1);
  const [event] = await stack.json<{ message: string }[]>('/alerts/events');
  expect(event?.message).toMatch(new RegExp(`^삼성전자 평단가 대비 ${MINUS}11\\.29%$`));
  await expect.poll(() => stack.notifies.length).toBeGreaterThan(0);
  const notify = stack.notifies[0];
  expect(notify).toMatchObject({ title: '알림: 삼성전자', route: '/symbols/KR/005930' });
  expect(notify?.body).toMatch(new RegExp(`^평단가 대비 ${MINUS}11\\.29%$`));
  for (const text of [event?.message ?? '', notify?.body ?? '']) {
    expect(text).not.toMatch(/62,?000|15주|한국투자|키움|보유/);
  }
  await goto(page, '#/alerts');
  await expect(
    page.getByRole('region', { name: '알림 이력' }).getByText(/평단가 대비/),
  ).toBeVisible();
  expect(log.errors).toEqual([]);
});

test('V10 브리핑 구역: 보유가 있으면 "내 자산"(앱이 계산, AI 아님)이 붙고, AI 흉내로 가는 요청에는 보유 정보가 없다', async ({
  page,
  stack,
  shell,
  log,
}) => {
  void shell;
  await stack.setup();
  await price(stack, '035420', 210_000);
  await price(stack, 'NVDA', 130);
  const run = (market: 'KR' | 'US') => stack.json('/briefings/run', post({ market }));
  const items = () =>
    stack.json<{ id: number; market: string; status: string; missing: string[] }[]>('/briefings');

  // 보유가 없을 때: 내 자산 구역이 없고 빠진 항목으로도 세지 않는다
  await run('US');
  await expect.poll(async () => (await items()).length).toBe(1);
  const empty = await stack.json<{ my_assets: unknown }>(`/briefings/${(await items())[0]?.id}`);
  expect(empty.my_assets).toBeNull();
  expect((await items())[0]).toMatchObject({ market: 'US', status: 'done', missing: [] });

  // 보유가 생기고 어제까지의 기록이 있다
  for (const b of ['kis', 'kiwoom', 'meritz'] as const) await connect(stack, b);
  await sync(stack);
  await stack.json('/watchlist', post({ market: 'KR', code: '005930' })); // 보유이면서 감시 종목
  await stack.ctl('/daily/seed', {
    day: '2026-10-28',
    kr_value: 2_000_000,
    kr_cost: 2_112_000,
    us_value: 800,
    us_cost: 688,
    usdkrw: 1428,
  });
  await openApp(page, '#/briefings');
  await page.getByRole('button', { name: '국내 지금 만들기' }).click();
  await expect(page.getByText(/국내 .*브리핑이 도착했습니다\./)).toBeVisible({ timeout: 20_000 });
  const kr = (await items()).find((i) => i.market === 'KR');
  expect(kr).toMatchObject({ status: 'done', missing: [] });

  await test.step('저장된 내 자산: 전일 종가 대비 변화와 기여 최대·최소(국내 2,100원 = 21주 × 100, 달러 -126 = 4.5주 × -28)', async () => {
    const detail = await stack.json<{
      data: Record<string, unknown>;
      my_assets: {
        change_krw: number | null;
        currencies: Record<string, { change: number | null }>;
        top: { name: string; amount: number } | null;
        bottom: { name: string; amount: number; currency: string } | null;
      };
    }>(`/briefings/${kr?.id}`);
    const mine = detail.my_assets;
    near(mine.currencies.KRW?.change, 2_100);
    near(mine.currencies.USD?.change, -126);
    near(mine.change_krw, 2_100 - 126 * 1403, 1);
    expect(mine.top).toMatchObject({ name: '삼성전자' });
    near(mine.top?.amount, 1_500);
    expect(mine.bottom).toMatchObject({ name: '애플', currency: 'USD' });
    near(mine.bottom?.amount, -70);
    expect(JSON.stringify(detail.data)).not.toMatch(/my_assets|평단|보유/);
  });

  await test.step('화면: 내 자산 구역과 "AI를 거치지 않습니다" 표시', async () => {
    await page.getByRole('link', { name: '도착한 브리핑 읽기' }).click();
    await expect(main(page).getByRole('heading', { name: '내 자산' })).toBeVisible();
    await expect(main(page).getByText('앱이 계산한 값입니다. AI를 거치지 않습니다.')).toBeVisible();
    await expect(main(page).getByText('가장 많이 기여')).toBeVisible();
    await expect(main(page).getByText('삼성전자').first()).toBeVisible();
  });

  await test.step('AI 흉내가 받은 요청 전체에 보유·평단가·증권사·계좌 정보가 없다', async () => {
    const prompts = (await stack.state()).ai_inputs;
    expect(prompts.length).toBeGreaterThanOrEqual(2); // 미국 + 국내
    const all = prompts.join('\n');
    expect(all).toContain('삼성전자'); // 감시 종목은 보내도 된다(보유 여부는 없다)
    const forbidden = [
      // 보유만 한 종목과 그 코드
      'NAVER',
      '035420',
      '엔비디아',
      'NVDA',
      'SK하이닉스',
      '000660',
      '애플',
      'AAPL',
      // 증권사, 계좌, 수량·평단가·금액
      '키움',
      '메리츠',
      '한국투자',
      '12345678',
      '7801',
      '62000',
      '194000',
      '195.2',
      '885000',
      '2110500',
      // 앱이 계산한 구역과 보유 표현
      'my_assets',
      'change_krw',
      '평단',
      '보유',
      '수량',
    ];
    expect(forbidden.filter((word) => all.includes(word))).toEqual([]);
    for (const secret of SECRETS) expect(all).not.toContain(secret);
  });
  expect(log.errors).toEqual([]);
});

test('V12 주문 경로 0: 세 어댑터가 부른 호출, 한투 TR, 화면이 부른 경로와 화면의 버튼, 화면이 아는 API 어디에도 주문·정정·취소가 없다', async ({
  page,
  stack,
  shell,
  log,
}) => {
  void shell;
  await holdAll(stack);
  await stack.json('/watchlist', post({ market: 'KR', code: '005930' }));
  await saveManual(stack, {
    broker_id: 'samsung',
    market: 'KR',
    code: '005930',
    quantity: '1',
    avg_price: 1000,
  });
  await stack.json('/briefings/run', post({ market: 'KR' }));
  await expect.poll(async () => (await stack.json<unknown[]>('/briefings')).length).toBe(1);

  const visits = [
    '#/home',
    '#/alerts',
    '#/symbols/KR/005930',
    '#/briefings',
    '#/analyses',
    '#/settings',
  ];
  await openApp(page, '#/home');
  for (const hash of visits) {
    await goto(page, hash);
    await expect(main(page).getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForTimeout(400);
    const orderish = page.getByRole('button', {
      name: /주문|정정|매수하기|매도하기|^매수$|^매도$/,
    });
    expect(await orderish.count(), `${hash}: 주문 버튼`).toBe(0);
    expect(await page.getByRole('link', { name: /주문|정정/ }).count(), `${hash}: 주문 링크`).toBe(
      0,
    );
  }
  await page.getByRole('button', { name: '종목 추가' }).count(); // 화면을 한 바퀴 더 돌린 뒤 요청을 모은다

  const paths = new Set(
    log.requests
      .filter((r) => r.url().startsWith('http://127.0.0.1:'))
      .map((r) => `${r.method()} ${new URL(r.url()).pathname}`),
  );
  expect([...paths].filter((p) => /order|ordr|trading|주문|rsvn|exchange/i.test(p))).toEqual([]);

  const state = await stack.state();
  const calls = [...state.broker_calls.kiwoom, ...state.broker_calls.meritz];
  expect(calls.filter((c) => c.startsWith('UNEXPECTED'))).toEqual([]);
  expect(new Set(state.broker_calls.kiwoom)).toEqual(
    new Set(['POST /oauth2/token', 'POST /api/dostk/acnt', 'POST /api/us/acnt']),
  );
  expect([...new Set(state.broker_calls.meritz)].sort()).toEqual([
    'GET /accounts/v1/me/holdings',
    'GET /accounts/v1/me/overseas/holdings',
    'POST /oauth2/token',
  ]); // 토큰 발급 말고는 GET 조회뿐(오래된 토큰을 거두는 /oauth2/revoke도 부르지 않는다)
  const kisTrading = state.rest_paths.filter((p) => p.includes('/trading/'));
  expect(new Set(kisTrading)).toEqual(
    new Set([
      '/uapi/domestic-stock/v1/trading/inquire-balance',
      '/uapi/overseas-stock/v1/trading/inquire-present-balance',
    ]),
  );
  // 한투 TR: 조회는 R로 끝나고 주문·정정·취소는 U로 끝난다(`test_readonly_guarantee.py`와 같은 기준)
  expect(state.rest_trs.filter((tr) => /^[A-Z]{4}\d{4}U$/.test(tr))).toEqual([]);

  // 화면이 아는 API(OpenAPI에서 만든 타입)에 주문 경로가 없다
  const schema = readFileSync(join(import.meta.dirname, '../../src/api/schema.d.ts'), 'utf8');
  const apiPaths = [...schema.matchAll(/^ {2}'(\/[^']*)': \{/gm)].map((m) => m[1] as string);
  expect(apiPaths.length).toBeGreaterThan(40);
  expect(apiPaths.filter((p) => /order|ordr|trading|rsvn|exchange|revoke/i.test(p))).toEqual([]);
  expect(log.errors).toEqual([]);
});
