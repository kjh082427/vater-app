import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// tokens.css가 색의 유일한 출처다. 대비(WCAG 2.2 AA)를 실제 값으로 계산해 확인한다.
const here = import.meta.dirname;
const tokensCss = readFileSync(join(here, 'tokens.css'), 'utf8');

function rootTokens(css: string): Map<string, string> {
  const root = /:root\s*{([^}]*)}/.exec(css)?.[1] ?? '';
  const map = new Map<string, string>();
  for (const m of root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    map.set(m[1] as string, (m[2] as string).trim());
  }
  return map;
}

const tokens = rootTokens(tokensCss);

function hex(name: string): string {
  const value = tokens.get(name);
  if (!value || !/^#[0-9a-f]{6}$/.test(value)) {
    throw new Error(`${name}은(는) 소문자 6자리 hex여야 합니다: ${String(value)}`);
  }
  return value;
}

function luminance(color: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(color.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('색 토큰', () => {
  it('정해진 의미 토큰을 모두 정의한다', () => {
    const required = [
      '--color-paper',
      '--color-chrome',
      '--color-hover',
      '--color-selected',
      '--color-selection',
      '--color-line',
      '--color-rule',
      '--color-rule-section',
      '--color-control',
      '--color-ink',
      '--color-ink-2',
      '--color-ink-3',
      '--color-ink-hover',
      '--color-on-ink',
      '--color-up',
      '--color-down',
      '--color-caution',
      '--color-caution-bg',
      '--color-caution-ink',
      '--color-focus',
    ];
    expect(required.filter((name) => !tokens.has(name))).toEqual([]);
  });

  it('검증 함수 자체: 흰 바탕 위 검정은 21:1, 같은 색은 1:1', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5);
  });

  // 글자: 4.5:1 이상
  const textPairs: [string, string][] = [];
  for (const fg of [
    '--color-ink',
    '--color-ink-2',
    '--color-ink-3',
    '--color-up',
    '--color-down',
  ]) {
    for (const bg of ['--color-paper', '--color-chrome', '--color-hover', '--color-selected']) {
      textPairs.push([fg, bg]);
    }
  }
  textPairs.push(
    ['--color-on-ink', '--color-ink'],
    ['--color-on-ink', '--color-ink-hover'],
    ['--color-caution-ink', '--color-caution-bg'],
    ['--color-caution-ink', '--color-paper'],
    ['--color-caution-ink', '--color-chrome'],
    ['--color-ink', '--color-caution-bg'],
    ['--color-ink', '--color-selection'],
  );

  it.each(textPairs)('글자 %s / 바탕 %s: 4.5:1 이상', (fg, bg) => {
    expect(contrast(hex(fg), hex(bg))).toBeGreaterThanOrEqual(4.5);
  });

  // 글자가 아닌 그래픽(상태 점, 미니 차트 선, 포커스 링, 눈금): 3:1 이상 (WCAG 1.4.11)
  const graphicPairs: [string, string][] = [
    ['--color-caution', '--color-paper'],
    ['--color-caution', '--color-chrome'],
    ['--color-up', '--color-paper'],
    ['--color-down', '--color-paper'],
    ['--color-focus', '--color-paper'],
    ['--color-focus', '--color-chrome'],
    ['--color-ink-3', '--color-chrome'],
    ['--color-rule-section', '--color-paper'],
  ];

  it.each(graphicPairs)('그래픽 %s / 바탕 %s: 3:1 이상', (fg, bg) => {
    expect(contrast(hex(fg), hex(bg))).toBeGreaterThanOrEqual(3);
  });
});

describe('다크 테마 준비', () => {
  it('컴포넌트 CSS는 색 값을 직접 쓰지 않고 토큰(var)만 쓴다', () => {
    const dir = join(here, 'components');
    const cssFiles = [
      join(here, 'base.css'),
      ...(existsSync(dir) ? readdirSync(dir, { recursive: true, encoding: 'utf8' }) : [])
        .filter((name) => name.endsWith('.css'))
        .map((name) => join(dir, name)),
    ];
    const offenders = cssFiles.flatMap((path) => {
      const css = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      const hits = css.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/g) ?? [];
      return hits.map((hit) => `${path.slice(here.length + 1)}: ${hit}`);
    });
    expect(offenders).toEqual([]);
  });

  it('라이트 테마만 선언한다(color-scheme: light)', () => {
    expect(tokensCss).toMatch(/color-scheme:\s*light;/);
  });
});

describe('토큰 참조', () => {
  it('CSS가 쓰는 var(--*)는 모두 tokens.css에 정의되어 있다', () => {
    const cssFiles = readdirSync(here, { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.css') && name !== 'tokens.css')
      .map((name) => join(here, name));
    const missing = cssFiles.flatMap((path) => {
      const used = [...readFileSync(path, 'utf8').matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]);
      return used
        .filter((name) => !tokens.has(name as string))
        .map((name) => `${path.slice(here.length + 1)}: ${name}`);
    });
    expect(missing).toEqual([]);
  });

  it('정의만 하고 아무 데서도 쓰지 않는 색 토큰이 없다', () => {
    const sources = readdirSync(here, { recursive: true, encoding: 'utf8' })
      .filter(
        // 견본(gallery)은 토큰 이름을 늘어놓을 뿐이라 "쓰임"으로 치지 않는다
        (name) =>
          /\.(css|tsx?)$/.test(name) &&
          name !== 'tokens.css' &&
          !name.includes('.test.') &&
          !name.startsWith('gallery'),
      )
      .map((name) => readFileSync(join(here, name), 'utf8'))
      .join('\n');
    const unused = [...tokens.keys()].filter(
      (name) => name.startsWith('--color-') && !sources.includes(`var(${name})`),
    );
    expect(unused).toEqual([]);
  });
});

describe('크기 토큰', () => {
  it('글자 크기와 간격은 rem이다(Windows 배율·글자 크기 설정을 따른다)', () => {
    const sized = [...tokens].filter(([name]) => /^--(text|leading|space|size)-/.test(name));
    expect(sized.length).toBeGreaterThan(10);
    expect(sized.filter(([, value]) => !/^-?[\d.]+rem$|^0$/.test(value))).toEqual([]);
  });

  it('선 굵기: 머리카락 1px, 구역 2px', () => {
    expect(tokens.get('--rule-hair')).toBe('1px');
    expect(tokens.get('--rule-section')).toBe('2px');
  });

  it('움직임을 줄이라는 설정에서는 전환 시간을 0으로', () => {
    expect(tokensCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*{\s*:root\s*{[^}]*--duration-fast:\s*0ms/,
    );
  });
});
