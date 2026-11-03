/// <reference types="vitest/config" />
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 페이지 2개: index.html(앱, 화면은 ui/screens에서 채운다)과 gallery.html(디자인 시스템 견본).
export default defineConfig({
  plugins: [react()],
  // Tauri가 dist/를 파일로 읽으므로 상대 경로로 빌드한다.
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        gallery: resolve(import.meta.dirname, 'gallery.html'),
      },
    },
  },
  server: {
    // 사이드카 CORS가 개발 모드에서 허용하는 출처(스펙 2-1): http://localhost:5173
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
    restoreMocks: true,
  },
});
