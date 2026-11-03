/**
 * U11·U12: AI 종목 분석 끝까지(스펙 5장, 8장). 작업 큐·저장·SSE·알림 이력은 실제이고 엔진만 가짜다.
 * 가짜 엔진은 실제 엔진처럼 5단계(analysts→research→trader→risk→portfolio) 진행을 보낸다.
 */
import type { Page } from '@playwright/test';
import { defaultDoc } from '../../src/dashboard/layout/defaults';
import { expect, main, openApp, test, type Stack } from './harness';

const STAGE_LABELS = [
  '애널리스트',
  '강세·약세 토론',
  '트레이더',
  '리스크 토론',
  '포트폴리오 매니저',
];

/** 사이드카 SSE를 테스트 쪽에서도 듣는다(화면과 같은 /events?token=). */
function listen(stack: Stack) {
  const events: { type: string; data: Record<string, unknown> }[] = [];
  const abort = new AbortController();
  void (async () => {
    try {
      const res = await fetch(`${stack.base}/events?token=${stack.token}`, {
        signal: abort.signal,
      });
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf('\r\n\r\n')) >= 0 || (cut = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + (buffer.startsWith('\r\n', cut) ? 4 : 2));
          const type = /^event: ?(.*)$/m.exec(block)?.[1]?.trim();
          const data = /^data: ?(.*)$/m.exec(block)?.[1];
          if (type && data)
            events.push({ type, data: JSON.parse(data) as Record<string, unknown> });
        }
      }
    } catch {
      // 테스트가 끝나며 끊는다
    }
  })();
  return { events, close: () => abort.abort() };
}

async function startFromScreen(page: Page) {
  await openApp(page, '#/analyses');
  const form = page.getByRole('form', { name: '새 분석' });
  await form.getByRole('searchbox', { name: '종목 검색' }).fill('삼성');
  await form.getByRole('button', { name: '삼성전자 선택' }).click();
  await form.getByRole('button', { name: '분석 시작' }).click();
  await expect(page).toHaveURL(/#\/analyses\/\d+$/);
  return Number(/#\/analyses\/(\d+)$/.exec(page.url())?.[1]);
}

test('U11 분석 끝까지: 5단계 진행 → 결과(눈금·3줄 요약·에이전트 탭·실행 정보·면책), 홈 진행 중에서 사라짐, 이력 1건', async ({
  page,
  stack,
  shell,
  log,
}) => {
  void shell;
  await stack.setup();
  // 기본 대시보드의 '최근 알림' 칸을 '진행 중인 분석'으로 바꿔 둔다(사용자가 칸 내용을 바꾼 것과 같음)
  const doc = defaultDoc();
  const home = doc.dashboards[0];
  if (!home) throw new Error('기본 대시보드가 없습니다');
  home.panels = home.panels.map((p) =>
    p.type === 'recent-alerts' ? { type: 'running-analyses', options: {} } : p,
  );
  await stack.json('/ui/dashboards', { method: 'PUT', body: JSON.stringify(doc) });
  await stack.ctl('/analysis', { stage_sec: 1.5 });
  const sse = listen(stack);
  const id = await startFromScreen(page);

  // 진행 타임라인: 5단계, 지금 단계가 '진행 중'으로 앞으로 간다
  const steps = page.getByRole('list', { name: '진행 단계' }).getByRole('listitem');
  await expect(steps).toHaveCount(5);
  for (const [i, label] of STAGE_LABELS.entries()) await expect(steps.nth(i)).toContainText(label);
  await expect(steps.nth(1)).toContainText('진행 중', { timeout: 10_000 });
  await expect(steps.nth(0)).toContainText('완료');

  // 홈의 "진행 중인 분석"에 있다가, 끝나면 사라진다
  await openApp(page, '#/home');
  const active = main(page).getByRole('region', { name: /: 진행 중인 분석$/ });
  await expect(active.getByRole('link', { name: '삼성전자' })).toBeVisible();
  await expect(active.getByRole('progressbar', { name: '삼성전자 분석 진행' })).toBeVisible();
  await expect(active.getByText('진행 중인 분석이 없습니다', { exact: false })).toBeVisible({
    timeout: 20_000,
  });
  await expect(active.getByRole('link', { name: '삼성전자' })).toHaveCount(0);

  // 결과 화면
  await openApp(page, `#/analyses/${id}`);
  await expect(main(page).getByRole('heading', { level: 1, name: '삼성전자 분석' })).toBeVisible();
  await expect(page.getByRole('img', { name: /^AI 의견 매수/ })).toBeVisible();
  const reasons = page.getByRole('list', { name: '핵심 근거' }).getByRole('listitem');
  await expect(reasons).toHaveCount(3);
  await expect(reasons.first()).toHaveText('메모리 업황이 회복되고 있습니다.');
  await expect(page.getByText('목표가 250000 · 기간 3-6 months')).toBeVisible();
  const tabs = page.getByRole('tablist', { name: '에이전트' }).getByRole('tab');
  await expect(tabs).toHaveText([
    '시장 분석',
    '소셜 분석',
    '뉴스 분석',
    '재무 분석',
    '리서치 매니저',
    '트레이더',
    '포트폴리오 매니저',
  ]);
  await tabs.filter({ hasText: '트레이더' }).click();
  await expect(
    page.getByRole('tabpanel').getByText('트레이더: 분할 매수를 제안합니다.'),
  ).toBeVisible();
  const run = main(page).getByRole('region', { name: '실행 정보' });
  await expect(run.getByText('google · ', { exact: false }).first()).toBeVisible();
  await expect(run.getByText('입력 12,000 · 출력 3,400')).toBeVisible();
  await expect(run.getByRole('table', { name: '단계별 시간' }).getByRole('row')).toHaveCount(6);
  await expect(page.getByText('투자 판단 보조용이며 투자 권유가 아닙니다.').first()).toBeVisible();
  await expect(page.getByText('모델과 실행에 따라 결론이 달라질 수 있습니다.')).toBeVisible();

  // 진행 소식은 다섯 단계뿐(other 없음), 순서대로
  const stages = sse.events
    .filter((e) => e.type === 'analysis.progress' && e.data.id === id)
    .map((e) => e.data.stage);
  sse.close();
  expect(stages).toEqual(['analysts', 'research', 'trader', 'risk', 'portfolio']);

  // 분석 이력 1건, 알림 이력에 완료 1건, 셸 알림(누르면 결과 화면)
  await openApp(page, '#/analyses');
  const history = page.getByRole('table', { name: '분석 이력' });
  await expect(history.getByRole('row')).toHaveCount(2);
  await expect(history.getByRole('row').nth(1)).toContainText('삼성전자');
  const events = await stack.json<{ message: string }[]>('/alerts/events');
  expect(events.map((e) => e.message)).toEqual(['AI 분석 완료: 삼성전자 — 매수']);
  expect(stack.notifies.map((n) => [n.title, n.route])).toContainEqual([
    '분석 완료',
    `/analyses/${id}`,
  ]);
  expect(log.errors).toEqual([]);
});

test('U12 분석 실패(LLM 오류) → "분석 실패: 원인" → [다시 시도]하면 완료', async ({
  page,
  stack,
  shell,
}) => {
  void shell;
  await stack.setup();
  await stack.ctl('/analysis', { fail: true, stage_sec: 0.3 });
  const id = await startFromScreen(page);

  const failed = main(page).getByRole('region', { name: '분석 실패' });
  await expect(failed).toBeVisible({ timeout: 15_000 });
  await expect(failed.getByText('분석 중 오류가 났습니다 (ResourceExhausted).')).toBeVisible();
  await expect(
    failed.getByText('다시 시도하거나 설정 > 로그 폴더에서 원인을 확인하세요.', { exact: false }),
  ).toBeVisible();
  await expect(failed.getByRole('button', { name: 'AI 사용 방식 바꿔 새로 분석' })).toBeVisible();
  const steps = failed.getByRole('list', { name: '진행 단계' }).getByRole('listitem');
  // 실패한 분석은 단계별 시간이 저장되지 않아(사이드카가 실패 때 timings를 남기지 않음) 모든 단계가
  // '진행 안 됨'으로 보인다. 스펙이 요구하지는 않아 여기서는 다섯 단계가 보이는지만 본다.
  await expect(steps).toHaveCount(5);

  await stack.ctl('/analysis', { fail: false });
  await failed.getByRole('button', { name: '다시 시도' }).click();
  await expect(page).not.toHaveURL(new RegExp(`#/analyses/${id}$`));
  await expect(page).toHaveURL(/#\/analyses\/\d+$/);
  await expect(page.getByRole('img', { name: /^AI 의견 매수/ })).toBeVisible({ timeout: 15_000 });

  const events = await stack.json<{ message: string }[]>('/alerts/events');
  expect(events.map((e) => e.message)).toEqual([
    'AI 분석 완료: 삼성전자 — 매수',
    'AI 분석 실패: 삼성전자 — 분석 중 오류가 났습니다 (ResourceExhausted).',
  ]);
});
