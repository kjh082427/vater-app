import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// 글꼴은 앱에 들어 있어야 한다(오프라인 동작, PRODUCT.md). 이 테스트는 실제 파일을 읽는다.
const here = import.meta.dirname;
const appRoot = resolve(here, '../..');
const fontsCss = readFileSync(join(here, 'fonts.css'), 'utf8');

type Face = { family: string; weight: string; url: string };

function faces(css: string): Face[] {
  const blocks = css.match(/@font-face\s*{[^}]*}/g) ?? [];
  return blocks.map((block) => ({
    family: /font-family:\s*'([^']+)'/.exec(block)?.[1] ?? '',
    weight: /font-weight:\s*([^;]+);/.exec(block)?.[1]?.trim() ?? '',
    url: /url\(['"]?([^'")]+)['"]?\)/.exec(block)?.[1] ?? '',
  }));
}

function filesUnder(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((name) => join(dir, name))
    .filter((path) => pattern.test(path) && !path.includes('node_modules'));
}

describe('글꼴 파일 (fonts.css)', () => {
  it('Pretendard 4굵기(400·500·600·700)와 Hahmlet 가변(400~700)을 선언한다', () => {
    const declared = faces(fontsCss).map(({ family, weight }) => `${family} ${weight}`);
    expect(declared).toEqual([
      'Pretendard 400',
      'Pretendard 500',
      'Pretendard 600',
      'Pretendard 700',
      'Hahmlet 400 700',
    ]);
  });

  it.each(faces(fontsCss))('$family $weight: 앱 안의 woff2 파일을 가리킨다', ({ url }) => {
    expect(url).toMatch(/^\.\/fonts\/[\w.-]+\.woff2$/);
    const bytes = readFileSync(join(here, url));
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('wOF2');
  });

  it('용량 예산: Pretendard 1개 300KB 이하, Hahmlet 450KB 이하, 합계 1.6MB 이하', () => {
    const sizes = faces(fontsCss).map(({ family, url }) => ({
      family,
      bytes: statSync(join(here, url)).size,
    }));
    for (const { family, bytes } of sizes) {
      expect(bytes).toBeLessThanOrEqual(family === 'Hahmlet' ? 450 * 1024 : 300 * 1024);
    }
    expect(sizes.reduce((sum, s) => sum + s.bytes, 0)).toBeLessThanOrEqual(1.6 * 1024 * 1024);
  });

  it('글꼴마다 OFL 라이선스 파일이 같이 있다', () => {
    for (const name of ['LICENSE-Pretendard.txt', 'LICENSE-Hahmlet.txt']) {
      const text = readFileSync(join(here, 'fonts', name), 'utf8');
      expect(text).toContain('SIL Open Font License, Version 1.1');
    }
  });
});

describe('오프라인 보장', () => {
  it('CSS, HTML, 소스 어디에서도 외부 글꼴·스타일을 불러오지 않는다', () => {
    const files = [
      ...filesUnder(join(appRoot, 'src'), /\.(css|tsx?|html)$/),
      ...filesUnder(appRoot, /^[^/]*\.html$/).filter((p) => !p.includes('/dist/')),
      join(appRoot, 'index.html'),
      join(appRoot, 'gallery.html'),
    ].filter((p) => !p.endsWith('.test.ts') && !p.endsWith('.test.tsx'));
    const offenders = files.filter((path) =>
      /(url\(\s*['"]?https?:|@import\s+(url\()?['"]?https?:|<link[^>]+href=["']https?:)/i.test(
        readFileSync(path, 'utf8'),
      ),
    );
    expect(offenders.map((p) => relative(appRoot, p))).toEqual([]);
  });
});
