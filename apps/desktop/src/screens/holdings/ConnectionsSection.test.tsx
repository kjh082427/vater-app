import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ConnectionOut } from '../../api/types';
import { renderWithServices } from '../../test/render';
import { choose } from '../../test/select';
import { mock, server } from '../../test/server';
import { ConnectionsSection } from './ConnectionsSection';

const FAKE_KEY = 'fakeAppKey-for-tests-0000000000';
const FAKE_SECRET = 'fake-secret-for-tests-only-1111';

function conn(
  over: Partial<ConnectionOut> & Pick<ConnectionOut, 'id' | 'broker_id'>,
): ConnectionOut {
  return {
    account_mask: '****1234',
    status: 'ok',
    last_synced_at: '2026-11-06T14:00:00+09:00',
    last_error: null,
    server: null,
    ...over,
  };
}

/** 이 요청들의 방법·경로·본문을 모은다. */
function capture(method: string, pathPrefix: string) {
  const seen: { path: string; body: unknown }[] = [];
  server.events.on('request:start', async ({ request }) => {
    const url = new URL(request.url);
    if (request.method === method && url.pathname.startsWith(pathPrefix)) {
      const text = await request.clone().text();
      seen.push({ path: url.pathname + url.search, body: text ? JSON.parse(text) : null });
    }
  });
  return seen;
}

function renderSection() {
  const view = renderWithServices(<ConnectionsSection />);
  return view;
}

describe('증권사 연결 목록', () => {
  it('연결이 하나도 없으면 연결 안내를 보인다', async () => {
    renderSection();
    expect(await screen.findByText(/연결한 증권사가 없습니다/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '연결 추가' })).toBeInTheDocument();
  });

  it('마스킹 계좌와 상태를 보인다: 증권사 이름은 글자, 키움은 키 구분', async () => {
    mock.db.connections = [
      conn({ id: 1, broker_id: 'kis', account_mask: '****1234', server: 'prod' }),
      conn({ id: 2, broker_id: 'kiwoom', account_mask: '키 ab12' }),
    ];
    renderSection();
    const list = await screen.findByRole('list', { name: '연결한 증권사' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0] as HTMLElement).getByText('한국투자')).toBeInTheDocument();
    expect(within(items[0] as HTMLElement).getByText('****1234')).toBeInTheDocument();
    expect(within(items[0] as HTMLElement).getByText('연결됨')).toBeInTheDocument();
    expect(within(items[1] as HTMLElement).getByText('키 ab12')).toBeInTheDocument();
  });
});

describe('연결 추가', () => {
  it('키움은 계좌번호 없이 앱키·시크릿만 받는다. 성공하면 칸을 비우고 키는 화면에 남지 않는다', async () => {
    const posts = capture('POST', '/connections');
    const view = renderSection();
    await userEvent.click(await screen.findByRole('button', { name: '연결 추가' }));
    await choose(document.body, '증권사', '키움');
    expect(screen.queryByLabelText('계좌번호')).not.toBeInTheDocument();
    const key = screen.getByLabelText('앱키');
    expect(key).toHaveAttribute('type', 'password');
    expect(key).toHaveAttribute('autocomplete', 'off');
    await userEvent.type(key, FAKE_KEY);
    await userEvent.type(screen.getByLabelText('앱시크릿'), FAKE_SECRET);
    await userEvent.click(screen.getByRole('button', { name: '연결' }));
    expect(await screen.findByText(/^키 [0-9a-f]{4}$/)).toBeInTheDocument();
    expect(posts).toEqual([
      {
        path: '/connections',
        body: { broker_id: 'kiwoom', app_key: FAKE_KEY, app_secret: FAKE_SECRET },
      },
    ]);
    expect(screen.queryByLabelText('앱키')).not.toBeInTheDocument();
    expect(view.container.innerHTML).not.toContain(FAKE_KEY);
    expect(view.container.innerHTML).not.toContain(FAKE_SECRET);
  });

  it('연결 테스트가 실패하면 저장하지 않고 원인과 hint를 보인다(목록은 그대로, 칸은 남는다)', async () => {
    const { http, HttpResponse } = await import('msw');
    server.use(
      http.post('*/connections', () =>
        HttpResponse.json(
          {
            code: 'BROKER_AUTH',
            message: '키움이 키를 거절했습니다.',
            hint: '앱키와 시크릿을 다시 확인하세요.',
          },
          { status: 401 },
        ),
      ),
    );
    renderSection();
    await userEvent.click(await screen.findByRole('button', { name: '연결 추가' }));
    await choose(document.body, '증권사', '키움');
    await userEvent.type(screen.getByLabelText('앱키'), FAKE_KEY);
    await userEvent.type(screen.getByLabelText('앱시크릿'), FAKE_SECRET);
    await userEvent.click(screen.getByRole('button', { name: '연결' }));
    expect(await screen.findByText(/키움이 키를 거절했습니다/)).toBeInTheDocument();
    expect(screen.getByText(/앱키와 시크릿을 다시 확인하세요/)).toBeInTheDocument();
    expect(mock.db.connections).toEqual([]);
    expect(screen.getByLabelText('앱키')).toHaveValue(FAKE_KEY);
  });

  it('한투는 계좌번호 10자리, 종합계좌(뒤 2자리 01)만: 아니면 보내지 않고 이유를 보인다', async () => {
    const posts = capture('POST', '/connections');
    renderSection();
    await userEvent.click(await screen.findByRole('button', { name: '연결 추가' }));
    expect(screen.queryByLabelText('앱키')).not.toBeInTheDocument(); // 한투 키는 위 한국투자증권 칸에 있다
    const account = screen.getByLabelText('계좌번호');
    await userEvent.type(account, '123456');
    await userEvent.click(screen.getByRole('button', { name: '연결' }));
    expect(await screen.findByText('계좌번호 10자리를 입력하세요.')).toBeInTheDocument();
    await userEvent.clear(account);
    await userEvent.type(account, '1234567802');
    await userEvent.click(screen.getByRole('button', { name: '연결' }));
    expect(
      await screen.findByText(/종합계좌\(뒤 2자리 01\)만 연결할 수 있습니다/),
    ).toBeInTheDocument();
    expect(posts).toEqual([]);
    await userEvent.clear(account);
    await userEvent.type(account, '1234567801');
    await userEvent.click(screen.getByRole('button', { name: '연결' }));
    expect(await screen.findByText('****7801')).toBeInTheDocument();
    expect(posts).toEqual([
      { path: '/connections', body: { broker_id: 'kis', account: '1234567801' } },
    ]);
  });

  it('메리츠를 고르면 MAC 주소 안내가 보인다', async () => {
    renderSection();
    await userEvent.click(await screen.findByRole('button', { name: '연결 추가' }));
    expect(screen.queryByText(/MAC 주소/)).not.toBeInTheDocument();
    await choose(document.body, '증권사', '메리츠');
    expect(screen.getByText(/MAC 주소/)).toBeInTheDocument();
    expect(screen.getByText(/메리츠에만/)).toBeInTheDocument();
  });

  it('같은 증권사에 같은 구분의 해제 연결이 있으면 "이전 내역을 이 연결로 바꿀까요?"를 묻는다', async () => {
    mock.db.connections = [
      conn({ id: 7, broker_id: 'kis', account_mask: '****7801', status: 'disconnected' }),
    ];
    mock.db.holdings = [
      {
        broker_id: 'kis',
        connection_id: 7,
        market: 'KR',
        code: '005930',
        name: '삼성전자',
        quantity: '10',
        avg_price: 64000,
        currency: 'KRW',
        source: 'api',
        updated_at: '2026-11-01T09:00:00+09:00',
        supported: true,
        unsupported_reason: null,
        is_new: false,
      },
    ];
    const posts = capture('POST', '/connections');
    renderSection();
    await userEvent.click(await screen.findByRole('button', { name: '연결 추가' }));
    await userEvent.type(screen.getByLabelText('계좌번호'), '1234567801');
    await userEvent.click(screen.getByRole('button', { name: '연결' }));
    const dialog = await screen.findByRole('dialog', { name: '이전 내역을 이 연결로 바꿀까요?' });
    await userEvent.click(within(dialog).getByRole('button', { name: '바꾸기' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]?.body).toEqual({ broker_id: 'kis', account: '1234567801', replaces: 7 });
    await waitFor(() => expect(mock.db.connections.map((c) => c.id)).not.toContain(7));
  });

  it('"새로 추가"를 고르면 replaces 없이 보낸다', async () => {
    mock.db.connections = [
      conn({ id: 7, broker_id: 'kis', account_mask: '****7801', status: 'disconnected' }),
    ];
    const posts = capture('POST', '/connections');
    renderSection();
    await userEvent.click(await screen.findByRole('button', { name: '연결 추가' }));
    await userEvent.type(screen.getByLabelText('계좌번호'), '1234567801');
    await userEvent.click(screen.getByRole('button', { name: '연결' }));
    const dialog = await screen.findByRole('dialog', { name: '이전 내역을 이 연결로 바꿀까요?' });
    await userEvent.click(within(dialog).getByRole('button', { name: '새로 추가' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]?.body).toEqual({ broker_id: 'kis', account: '1234567801' });
  });
});

describe('연결 해제와 끊김', () => {
  it('해제하면 스펙 문구로 삭제할지 묻는다: 데이터 삭제', async () => {
    mock.db.connections = [conn({ id: 1, broker_id: 'kiwoom', account_mask: '키 ab12' })];
    const dels = capture('DELETE', '/connections/');
    renderSection();
    await userEvent.click(await screen.findByRole('button', { name: '키움 키 ab12 연결 해제' }));
    const dialog = await screen.findByRole('dialog', { name: '키움 연결 해제' });
    expect(within(dialog).getByText(/기존 데이터를 삭제할까요/)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/자산 추이의 지난 기록과 감시 종목·규칙은 남습니다/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/키는 어느 쪽이든 지웁니다/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: '데이터 삭제' }));
    await waitFor(() =>
      expect(dels).toEqual([{ path: '/connections/1?delete_data=true', body: null }]),
    );
    expect(await screen.findByText(/연결한 증권사가 없습니다/)).toBeInTheDocument();
  });

  it('해제하면서 데이터는 유지하면 "연결 해제됨"으로 남는다', async () => {
    mock.db.connections = [conn({ id: 1, broker_id: 'kiwoom', account_mask: '키 ab12' })];
    const dels = capture('DELETE', '/connections/');
    renderSection();
    await userEvent.click(await screen.findByRole('button', { name: '키움 키 ab12 연결 해제' }));
    const dialog = await screen.findByRole('dialog', { name: '키움 연결 해제' });
    await userEvent.click(within(dialog).getByRole('button', { name: '데이터 유지' }));
    await waitFor(() =>
      expect(dels).toEqual([{ path: '/connections/1?delete_data=false', body: null }]),
    );
    expect(await screen.findByText('연결 해제됨')).toBeInTheDocument();
  });

  it('끊긴 연결: 알림과 [다시 연결]/[데이터 삭제], 마지막 갱신 시각을 함께 보인다', async () => {
    mock.db.connections = [
      conn({
        id: 3,
        broker_id: 'kiwoom',
        account_mask: '키 ab12',
        status: 'lost',
        last_error: '3개월 미접속으로 해지되었습니다.',
      }),
    ];
    const dels = capture('DELETE', '/brokers/');
    renderSection();
    expect(await screen.findByText('키움 연결이 끊겼습니다')).toBeInTheDocument();
    expect(screen.getByText(/저장된 수량은 마지막 갱신/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '다시 연결' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '데이터 삭제' }));
    // 바로 지우지 않고 먼저 묻는다
    const dialog = await screen.findByRole('dialog', { name: '키움 데이터 삭제' });
    expect(dels).toEqual([]);
    expect(within(dialog).getByText(/모든 연결과 보유 내역이 지워집니다/)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/자산 추이의 지난 기록과 감시 종목은 남습니다/),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: '삭제' }));
    await waitFor(() => expect(dels).toEqual([{ path: '/brokers/kiwoom/data', body: null }]));
    await waitFor(() => expect(mock.db.connections).toEqual([]));
  });

  it('데이터 삭제 확인에서 취소하면 아무것도 지우지 않는다', async () => {
    mock.db.connections = [
      conn({ id: 3, broker_id: 'kiwoom', account_mask: '키 ab12', status: 'disconnected' }),
    ];
    const dels = capture('DELETE', '/brokers/');
    renderSection();
    await userEvent.click(await screen.findByRole('button', { name: '데이터 삭제' }));
    const dialog = await screen.findByRole('dialog', { name: '키움 데이터 삭제' });
    await userEvent.click(within(dialog).getByRole('button', { name: '취소' }));
    expect(dels).toEqual([]);
    expect(mock.db.connections).toHaveLength(1);
  });

  it('해제 창의 오류는 닫으면 지워져 다시 열 때 남지 않는다', async () => {
    const { http, HttpResponse } = await import('msw');
    mock.db.connections = [conn({ id: 1, broker_id: 'kiwoom', account_mask: '키 ab12' })];
    server.use(
      http.delete('*/connections/:id', () =>
        HttpResponse.json(
          { code: 'INTERNAL', message: '해제하지 못했습니다.', hint: null },
          { status: 500 },
        ),
      ),
    );
    renderSection();
    const open = async () =>
      userEvent.click(await screen.findByRole('button', { name: '키움 키 ab12 연결 해제' }));
    await open();
    const dialog = await screen.findByRole('dialog', { name: '키움 연결 해제' });
    await userEvent.click(within(dialog).getByRole('button', { name: '데이터 유지' }));
    expect(await within(dialog).findByText('해제하지 못했습니다.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: '취소' }));
    await open();
    const again = await screen.findByRole('dialog', { name: '키움 연결 해제' });
    expect(within(again).queryByText('해제하지 못했습니다.')).not.toBeInTheDocument();
  });

  it('연결 요청이 진행 중이면 같은 요청을 다시 보내지 않는다', async () => {
    const { http, HttpResponse } = await import('msw');
    mock.db.connections = [
      conn({ id: 7, broker_id: 'kis', account_mask: '****7801', status: 'disconnected' }),
    ];
    let hits = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    server.use(
      http.post('*/connections', async () => {
        hits += 1;
        await gate;
        return HttpResponse.json(
          { code: 'BROKER_AUTH', message: '거절', hint: null },
          { status: 401 },
        );
      }),
    );
    renderSection();
    await userEvent.click(await screen.findByRole('button', { name: '연결 추가' }));
    await userEvent.type(screen.getByLabelText('계좌번호'), '1234567801');
    await userEvent.click(screen.getByRole('button', { name: '연결' }));
    const dialog = await screen.findByRole('dialog', { name: '이전 내역을 이 연결로 바꿀까요?' });
    await userEvent.dblClick(within(dialog).getByRole('button', { name: '새로 추가' }));
    release();
    await screen.findByText('거절');
    expect(hits).toBe(1);
  });

  it('연결 중인 증권사에는 [데이터 삭제]를 주지 않는다(409 BROKER_CONNECTED)', async () => {
    mock.db.connections = [conn({ id: 3, broker_id: 'kiwoom', account_mask: '키 ab12' })];
    renderSection();
    await screen.findByText('키 ab12');
    expect(screen.queryByRole('button', { name: '데이터 삭제' })).not.toBeInTheDocument();
  });

  it('[다시 연결]은 고른 옛 연결을 replaces로 보낸다', async () => {
    mock.db.connections = [
      conn({ id: 3, broker_id: 'kiwoom', account_mask: '키 ab12', status: 'lost' }),
    ];
    const posts = capture('POST', '/connections');
    renderSection();
    await userEvent.click(await screen.findByRole('button', { name: '다시 연결' }));
    expect(screen.getByText(/키움 연결을 다시 만듭니다/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('앱키'), FAKE_KEY);
    await userEvent.type(screen.getByLabelText('앱시크릿'), FAKE_SECRET);
    await userEvent.click(screen.getByRole('button', { name: '연결' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]?.body).toEqual({
      broker_id: 'kiwoom',
      app_key: FAKE_KEY,
      app_secret: FAKE_SECRET,
      replaces: 3,
    });
    await waitFor(() => expect(mock.db.connections.map((c) => c.id)).not.toContain(3));
  });

  it('[다시 연결]이 실패하면 옛 내역이 그대로 남는다', async () => {
    const { http, HttpResponse } = await import('msw');
    mock.db.connections = [
      conn({ id: 3, broker_id: 'kiwoom', account_mask: '키 ab12', status: 'lost' }),
    ];
    server.use(
      http.post('*/connections', () =>
        HttpResponse.json(
          { code: 'BROKER_AUTH', message: '키를 거절했습니다.', hint: '다시 확인하세요.' },
          { status: 401 },
        ),
      ),
    );
    renderSection();
    await userEvent.click(await screen.findByRole('button', { name: '다시 연결' }));
    await userEvent.type(screen.getByLabelText('앱키'), FAKE_KEY);
    await userEvent.type(screen.getByLabelText('앱시크릿'), FAKE_SECRET);
    await userEvent.click(screen.getByRole('button', { name: '연결' }));
    expect(await screen.findByText(/키를 거절했습니다/)).toBeInTheDocument();
    expect(mock.db.connections.map((c) => c.id)).toEqual([3]);
    expect(screen.getByText('키움 연결이 끊겼습니다')).toBeInTheDocument();
  });
});
