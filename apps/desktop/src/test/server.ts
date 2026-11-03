import { setupServer } from 'msw/node';
import { createHandlers, createMockDb, type MockDb } from '../mocks/handlers';

/** 테스트마다 새로 만드는 사이드카 흉내 자료. 테스트는 `mock.db`를 바꿔 상황을 만든다. */
export const mock: { db: MockDb } = { db: createMockDb() };

/** 사이드카 흉내(MSW). 처리기가 없는 요청은 테스트 실패로 본다. */
export const server = setupServer();

export function resetMockServer() {
  mock.db = createMockDb();
  server.resetHandlers(...createHandlers(mock.db));
}
