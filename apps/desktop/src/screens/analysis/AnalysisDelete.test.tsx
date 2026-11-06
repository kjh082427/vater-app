import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { AnalysisDetail } from '../../api/types';
import { App } from '../../app/App';
import { analysisDone } from '../../mocks/fixtures';
import { emit, renderWithServices } from '../../test/render';
import { mock, server } from '../../test/server';

function renderAt(hash: string) {
  window.location.hash = hash;
  return renderWithServices(<App />);
}

function addRunning(id = 40): AnalysisDetail {
  const running: AnalysisDetail = {
    ...analysisDone,
    id,
    status: 'running',
    decision: null,
    decision_ko: null,
    decision_changed: false,
    summary: null,
    price_target: null,
    time_horizon: null,
    reports: null,
    timings: null,
    tokens: null,
  };
  mock.db.analyses.push(running);
  return running;
}

function recordBodies() {
  const calls: { method: string; path: string; body: unknown }[] = [];
  server.events.on('request:start', async ({ request }) => {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/analyses') && request.method !== 'GET') {
      const text = await request.clone().text();
      calls.push({ method: request.method, path, body: text ? JSON.parse(text) : null });
    }
  });
  return calls;
}

describe('분석 이력 지우기', () => {
  it('고른 분석을 확인 창을 거쳐 한 번에 지운다', async () => {
    const calls = recordBodies();
    renderAt('#/analyses');
    const table = await screen.findByRole('table', { name: '분석 이력' });
    await userEvent.click(within(table).getByRole('checkbox', { name: '애플 분석 선택' }));
    await userEvent.click(screen.getByRole('button', { name: '선택한 분석 지우기' }));

    const dialog = await screen.findByRole('dialog', { name: '분석 1건을 지울까요?' });
    expect(within(dialog).getByText(/보고서와 중간 저장분도 함께 지웁니다/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: '지우기' }));

    await waitFor(() => expect(within(table).queryByText('애플')).not.toBeInTheDocument());
    expect(within(table).getByText('삼성전자')).toBeInTheDocument();
    expect(calls).toEqual([{ method: 'POST', path: '/analyses/delete', body: { ids: [6] } }]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('확인 창에서 취소하면 아무것도 지우지 않는다', async () => {
    const calls = recordBodies();
    renderAt('#/analyses');
    const table = await screen.findByRole('table', { name: '분석 이력' });
    await userEvent.click(within(table).getByRole('checkbox', { name: '애플 분석 선택' }));
    await userEvent.click(screen.getByRole('button', { name: '선택한 분석 지우기' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '취소' }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(table).getByText('애플')).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('대기·진행 중인 분석은 고를 수 없고 이유를 보인다', async () => {
    addRunning(40);
    renderAt('#/analyses');
    const table = await screen.findByRole('table', { name: '분석 이력' });
    // 진행 중인 40번이 가장 위 행(id 내림차순), 그다음 끝난 7번
    const boxes = within(table).getAllByRole('checkbox', { name: '삼성전자 분석 선택' });
    expect(boxes[0]).toBeDisabled();
    expect(boxes[1]).toBeEnabled();
    expect(screen.getByText('대기·진행 중인 분석은 지울 수 없습니다.')).toBeInTheDocument();
  });

  it('SSE analysis.deleted를 받으면 목록에서 뺀다', async () => {
    const { stream } = renderAt('#/analyses');
    const table = await screen.findByRole('table', { name: '분석 이력' });
    const source = await stream();
    emit(source, 'analysis.deleted', { ids: [6] });
    await waitFor(() => expect(within(table).queryByText('애플')).not.toBeInTheDocument());
    expect(within(table).getByText('삼성전자')).toBeInTheDocument();
  });

  it('지우지 못한 분석은 이유를 알려 준다', async () => {
    const calls = recordBodies();
    renderAt('#/analyses');
    const table = await screen.findByRole('table', { name: '분석 이력' });
    await userEvent.click(within(table).getByRole('checkbox', { name: '애플 분석 선택' }));
    // 고른 뒤 다른 곳에서 먼저 지워졌다
    mock.db.analyses = mock.db.analyses.filter((a) => a.id !== 6);
    await userEvent.click(screen.getByRole('button', { name: '선택한 분석 지우기' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '지우기' }),
    );
    expect(await screen.findByText('1건은 이미 지워졌거나 지우지 못했습니다.')).toBeInTheDocument();
    expect(calls).toHaveLength(1);
  });
});

describe('분석 상세 지우기', () => {
  it('[분석 지우기] → 확인 → DELETE → 목록으로 돌아간다', async () => {
    const calls = recordBodies();
    renderAt('#/analyses/6');
    await userEvent.click(await screen.findByRole('button', { name: '분석 지우기' }));
    const dialog = await screen.findByRole('dialog', { name: '분석 1건을 지울까요?' });
    await userEvent.click(within(dialog).getByRole('button', { name: '지우기' }));
    await waitFor(() => expect(window.location.hash).toBe('#/analyses'));
    expect(calls).toEqual([{ method: 'DELETE', path: '/analyses/6', body: null }]);
  });

  it('진행 중인 분석은 지우기를 막고 이유를 보인다', async () => {
    addRunning(40);
    renderAt('#/analyses/40');
    await screen.findByRole('region', { name: '진행' });
    expect(screen.getByRole('button', { name: '분석 지우기' })).toBeDisabled();
    expect(
      screen.getByText('진행 중인 분석은 끝나거나 취소한 뒤 지울 수 있습니다.'),
    ).toBeInTheDocument();
  });

  it('진행 중에 지우려다 409면 이유를 보여 준다', async () => {
    renderAt('#/analyses/6');
    await userEvent.click(await screen.findByRole('button', { name: '분석 지우기' }));
    // 확인 창이 떠 있는 사이 다시 시작됐다
    Object.assign(mock.db.analyses.find((a) => a.id === 6) ?? {}, { status: 'running' });
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '지우기' }),
    );
    expect(await screen.findByText('진행 중인 분석은 지울 수 없습니다.')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/analyses/6');
  });

  it('지워진 분석의 주소(알림 경로)는 "지워진 분석입니다"를 보여 준다', async () => {
    renderAt('#/analyses/999');
    expect(await screen.findByText('지워진 분석입니다')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '분석 목록' })).toHaveAttribute('href', '#/analyses');
  });

  it('보고 있던 분석이 지워지면(SSE) 같은 안내로 바뀐다', async () => {
    const { stream } = renderAt('#/analyses/6');
    await screen.findByRole('button', { name: '분석 지우기' });
    const source = await stream();
    emit(source, 'analysis.deleted', { ids: [6] });
    expect(await screen.findByText('지워진 분석입니다')).toBeInTheDocument();
  });
});
