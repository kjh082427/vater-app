/**
 * U13: 일일 시장 브리핑(스펙 6장, 8장). 서비스·저장·SSE·알림 이력은 실제이고 수집과 LLM 해석만 가짜다.
 * 브리핑 시계는 화 16:00 KST(국내 장 마감 뒤)다.
 */
import { expect, main, openApp, test } from './harness';

interface Item {
  id: number;
  market: string;
  status: string;
  missing: string[];
}

test('U13 브리핑: 장 마감 뒤 "지금 만들기"(국내) → done 1건, 상세에 지수 표·AI 문장·면책. LLM이 실패하면 partial + "AI 해석 없음(데이터만)"', async ({
  page,
  stack,
  shell,
  log,
}) => {
  void shell;
  await stack.setup();
  await openApp(page, '#/briefings');
  await expect(main(page).getByText(/아직 브리핑이 없습니다/)).toBeVisible();

  await page.getByRole('button', { name: '국내 지금 만들기' }).click();
  await expect(page.getByText(/국내 .*브리핑이 도착했습니다\./)).toBeVisible({ timeout: 15_000 });
  const list = main(page).getByRole('list', { name: '브리핑' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list.getByText('반도체 대형주가 지수를 끌어올렸습니다.')).toBeVisible();
  let items = await stack.json<Item[]>('/briefings');
  expect(items.map((i) => [i.market, i.status, i.missing])).toEqual([['KR', 'done', []]]);

  // 상세: 지수 표, AI 해석 문장, 면책
  await page.getByRole('link', { name: '도착한 브리핑 읽기' }).click();
  await expect(page).toHaveURL(new RegExp(`#/briefings/${items[0]?.id}$`));
  await expect(
    main(page).getByRole('heading', { level: 1, name: /국내 시장 브리핑$/ }),
  ).toBeVisible();
  const indices = main(page).getByRole('table', { name: '지수' });
  await expect(indices.getByRole('row', { name: /코스피/ })).toBeVisible();
  await expect(indices.getByRole('row', { name: /코스닥/ })).toBeVisible();
  await expect(main(page).getByText('코스피는 오름세로 마감했습니다.')).toBeVisible();
  await expect(main(page).getByText('투자 판단 보조용이며 투자 권유가 아닙니다.')).toBeVisible();

  // LLM 실패: 데이터만으로 만든다(partial)
  await stack.ctl('/llm', { fail: true });
  await openApp(page, '#/briefings');
  await page.getByRole('button', { name: '미국 지금 만들기' }).click();
  await expect(page.getByText(/미국 .*브리핑이 도착했습니다\./)).toBeVisible({ timeout: 15_000 });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list.getByText('AI 해석 없음(데이터만)')).toBeVisible();
  items = await stack.json<Item[]>('/briefings');
  expect(items.map((i) => [i.market, i.status, i.missing]).sort()).toEqual([
    ['KR', 'done', []],
    ['US', 'partial', ['interpretation']],
  ]);

  // 알림 이력과 셸 알림
  const events = await stack.json<{ message: string }[]>('/alerts/events');
  expect(events.map((e) => e.message)).toEqual([
    '시장 브리핑 도착: 미국 2026-11-02',
    '시장 브리핑 도착: 국내 2026-11-03',
  ]);
  expect(stack.notifies.filter((n) => n.title === '오늘의 시장 브리핑')).toHaveLength(2);
  expect(log.errors).toEqual([]);
});
