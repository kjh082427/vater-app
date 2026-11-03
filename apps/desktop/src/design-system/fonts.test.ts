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
  it('Pretendard 4굵기(400·500·600·700)만 선언한다(명조 Hahmlet은 쓰지 않는다)', () => {
    const declared = faces(fontsCss).map(({ family, weight }) => `${family} ${weight}`);
    expect(declared).toEqual([
      'Pretendard 400',
      'Pretendard 500',
      'Pretendard 600',
      'Pretendard 700',
    ]);
    expect(fontsCss).not.toMatch(/Hahmlet/);
  });

  it('fonts/ 폴더에는 선언한 글꼴 파일만 있다(번들에 남는 글꼴 없음)', () => {
    const declared = faces(fontsCss).map(({ url }) => url.replace('./fonts/', ''));
    const onDisk = readdirSync(join(here, 'fonts')).filter((name) => name.endsWith('.woff2'));
    expect(onDisk.sort()).toEqual(declared.sort());
  });

  it.each(faces(fontsCss))('$family $weight: 앱 안의 woff2 파일을 가리킨다', ({ url }) => {
    expect(url).toMatch(/^\.\/fonts\/[\w.-]+\.woff2$/);
    const bytes = readFileSync(join(here, url));
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('wOF2');
  });

  it('용량 예산: Pretendard 1개 300KB 이하, 합계 1.1MB 이하', () => {
    const sizes = faces(fontsCss).map(({ family, url }) => ({
      family,
      bytes: statSync(join(here, url)).size,
    }));
    for (const { family, bytes } of sizes) {
      expect(bytes, family).toBeLessThanOrEqual(300 * 1024);
    }
    expect(sizes.reduce((sum, s) => sum + s.bytes, 0)).toBeLessThanOrEqual(1.1 * 1024 * 1024);
  });

  it('글꼴마다 OFL 라이선스 파일이 같이 있고, 쓰지 않는 글꼴의 라이선스는 없다', () => {
    const licenses = readdirSync(join(here, 'fonts')).filter((name) => name.startsWith('LICENSE-'));
    expect(licenses).toEqual(['LICENSE-Pretendard.txt']);
    const text = readFileSync(join(here, 'fonts', 'LICENSE-Pretendard.txt'), 'utf8');
    expect(text).toContain('SIL Open Font License, Version 1.1');
  });
});

describe('오프라인 보장', () => {
  it('CSS, HTML, 소스 어디에서도 외부 글꼴·스타일을 불러오지 않는다', () => {
    // 앱 뿌리는 맨 위 HTML만 본다. 뿌리를 통째로 훑으면 node_modules·src-tauri/target까지 읽어 느리다.
    const topHtml = readdirSync(appRoot)
      .filter((name) => name.endsWith('.html'))
      .map((name) => join(appRoot, name));
    // 다른 브랜치가 맨 위 HTML을 더해도(예: mock.html) 같이 검사한다
    expect(topHtml.map((p) => relative(appRoot, p))).toEqual(
      expect.arrayContaining(['gallery.html', 'index.html']),
    );
    const files = [...filesUnder(join(appRoot, 'src'), /\.(css|tsx?|html)$/), ...topHtml].filter(
      (p) => !p.endsWith('.test.ts') && !p.endsWith('.test.tsx'),
    );
    const offenders = files.filter((path) =>
      /(url\(\s*['"]?https?:|@import\s+(url\()?['"]?https?:|<link[^>]+href=["']https?:)/i.test(
        readFileSync(path, 'utf8'),
      ),
    );
    expect(offenders.map((p) => relative(appRoot, p))).toEqual([]);
  });
});
