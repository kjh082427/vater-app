import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { FakeEventSource } from './FakeEventSource';
import { resetMockServer, server } from './server';

// findBy·waitFor 기다림(기본 1초): 병렬 실행 때 느려도 흔들리지 않게
configure({ asyncUtilTimeout: 3000 });

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});

beforeEach(() => {
  resetMockServer();
  FakeEventSource.reset();
  if (typeof window !== 'undefined') window.location.hash = '';
});

afterEach(() => {
  cleanup();
});

afterAll(() => {
  server.close();
});
