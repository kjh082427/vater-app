import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { FakeEventSource } from './FakeEventSource';
import { resetMockServer, server } from './server';

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
