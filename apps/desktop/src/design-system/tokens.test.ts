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
  // 별칭(var(--x))이면 가리키는 토큰의 값을 쓴다
  const alias = /^var\((--[\w-]+)\)$/.exec(tokens.get(name) ?? '')?.[1];
  if (alias) return hex(alias);
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

// 다른 토큰을 그대로 가리키는 토큰(var(--x) 하나)은 따로 쓰임을 세지 않는다.
function isAlias(name: string): boolean {
  return /^var\(--[\w-]+\)$/.test(tokens.get(name) ?? '');
}

/** 색상(hue), 0~360도. 무채색이면 NaN. */
function hueOf(color: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return Number.NaN;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** HSL 채도, 0~1. */
function saturationOf(color: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return 0;
  return (max - min) / (1 - Math.abs(2 * l - 1));
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

describe('색 토큰', () => {
  it('정해진 의미 토큰을 모두 정의한다', () => {
    const required = [
      // 대시보드 라이트(스펙 2026-11-03 5장)
      '--color-canvas',
      '--color-card',
      '--color-card-shadow',
      '--color-accent',
      '--color-accent-strong',
      '--color-accent-weak',
      '--color-on-accent',
      '--color-table-head',
      '--color-on-table-head',
      '--color-row-alt',
      '--color-tag',
      // 이어 쓰는 역할
      '--color-hover',
      '--color-selection',
      '--color-line',
      '--color-rule',
      '--color-control',
      '--color-ink',
      '--color-ink-2',
      '--color-ink-3',
      '--color-up',
      '--color-down',
      '--color-caution',
      '--color-caution-bg',
      '--color-caution-ink',
      '--color-focus',
    ];
    expect(required.filter((name) => !tokens.has(name))).toEqual([]);
  });

  it('예전 이름(별칭)은 화면을 새 토큰으로 옮긴 뒤 지웠다(ui/dashboard)', () => {
    for (const name of [
      '--color-paper',
      '--color-chrome',
      '--color-selected',
      '--color-rule-section',
      '--color-ink-hover',
      '--color-on-ink',
      '--font-serif',
    ]) {
      expect(tokens.has(name), name).toBe(false);
    }
  });

  it('검증 함수 자체: 흰 바탕 위 검정은 21:1, 같은 색은 1:1, 빨강 0도·파랑 240도', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5);
    expect(hueOf('#ff0000')).toBeCloseTo(0, 5);
    expect(hueOf('#0000ff')).toBeCloseTo(240, 5);
    expect(hueDistance(350, 10)).toBe(20);
    expect(saturationOf('#808080')).toBe(0);
  });

  // 글자: 4.5:1 이상
  const textPairs: [string, string][] = [];
  for (const fg of ['--color-ink', '--color-ink-2', '--color-ink-3']) {
    for (const bg of [
      '--color-canvas',
      '--color-card',
      '--color-row-alt',
      '--color-hover',
      '--color-accent-weak',
    ]) {
      textPairs.push([fg, bg]);
    }
  }
  for (const fg of ['--color-up', '--color-down']) {
    for (const bg of ['--color-card', '--color-row-alt', '--color-hover', '--color-canvas']) {
      textPairs.push([fg, bg]);
    }
  }
  textPairs.push(
    ['--color-accent', '--color-card'],
    ['--color-accent-strong', '--color-card'],
    ['--color-accent-strong', '--color-accent-weak'],
    ['--color-on-accent', '--color-accent'],
    ['--color-on-accent', '--color-accent-strong'],
    ['--color-on-table-head', '--color-table-head'],
    ['--color-on-accent', '--color-up'],
    ['--color-on-accent', '--color-down'],
    ['--color-caution-ink', '--color-caution-bg'],
    ['--color-caution-ink', '--color-card'],
    ['--color-caution-ink', '--color-canvas'],
    ['--color-ink', '--color-caution-bg'],
    ['--color-ink', '--color-selection'],
  );

  it.each(textPairs)('글자 %s / 바탕 %s: 4.5:1 이상', (fg, bg) => {
    expect(contrast(hex(fg), hex(bg))).toBeGreaterThanOrEqual(4.5);
  });

  // 글자가 아닌 그래픽(상태 점, 차트 선, 포커스 링, 분류 표지, 스위치): 3:1 이상 (WCAG 1.4.11)
  const graphicPairs: [string, string][] = [
    ['--color-caution', '--color-card'],
    ['--color-caution', '--color-canvas'],
    ['--color-up', '--color-card'],
    ['--color-down', '--color-card'],
    ['--color-accent', '--color-card'],
    ['--color-accent', '--color-canvas'],
    ['--color-focus', '--color-card'],
    ['--color-focus', '--color-canvas'],
    ['--color-focus', '--color-accent-weak'],
    ['--color-tag', '--color-card'],
    ['--color-ink-3', '--color-row-alt'],
    ['--color-control-strong', '--color-card'],
  ];

  it.each(graphicPairs)('그래픽 %s / 바탕 %s: 3:1 이상', (fg, bg) => {
    expect(contrast(hex(fg), hex(bg))).toBeGreaterThanOrEqual(3);
  });

  it('바탕 위계: 캔버스는 카드보다 어둡고, 교차 행은 카드와 구별된다', () => {
    expect(luminance(hex('--color-canvas'))).toBeLessThan(luminance(hex('--color-card')));
    expect(luminance(hex('--color-row-alt'))).toBeLessThan(luminance(hex('--color-card')));
    expect(hex('--color-card')).toBe('#ffffff');
  });
});

describe('빨강·파랑은 값의 방향에만', () => {
  it('강조색은 상승·하락 색과 색상이 40도 이상 떨어져 있다', () => {
    for (const accent of ['--color-accent', '--color-accent-strong']) {
      for (const dir of ['--color-up', '--color-down']) {
        expect(
          hueDistance(hueOf(hex(accent)), hueOf(hex(dir))),
          `${accent} ↔ ${dir}`,
        ).toBeGreaterThanOrEqual(40);
      }
    }
  });

  it('분류 표지(--color-tag)와 표 머리줄은 중립색이다(채도 25% 이하)', () => {
    expect(saturationOf(hex('--color-tag'))).toBeLessThanOrEqual(0.25);
    expect(saturationOf(hex('--color-table-head'))).toBeLessThanOrEqual(0.25);
  });

  it('상승·하락 토큰은 방향을 그리는 부품에서만 쓴다', () => {
    const allowed = new Set([
      'components/SignedNumber.module.css',
      'components/Sparkline.module.css',
      'components/DecisionScale.module.css',
      'components/LineChart.module.css',
      'components/DivergingBar.module.css',
    ]);
    const offenders = readdirSync(here, { recursive: true, encoding: 'utf8' })
      .filter(
        (name) =>
          /\.(css|tsx?)$/.test(name) && !name.includes('.test.') && !name.startsWith('gallery'),
      )
      .filter((name) => name !== 'tokens.css' && !allowed.has(name))
      .filter((name) => /var\(--color-(up|down)\)/.test(readFileSync(join(here, name), 'utf8')));
    expect(offenders).toEqual([]);
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
    // 다른 토큰(예: --shadow-card, --color-focus)의 값으로 쓰이는 것도 쓰임으로 친다
    const used = new Set([...sources.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1] as string));
    for (let grew = true; grew;) {
      grew = false;
      for (const name of [...used]) {
        for (const m of (tokens.get(name) ?? '').matchAll(/var\((--[\w-]+)/g)) {
          if (!used.has(m[1] as string)) {
            used.add(m[1] as string);
            grew = true;
          }
        }
      }
    }
    const unused = [...tokens.keys()].filter(
      (name) => name.startsWith('--color-') && !isAlias(name) && !used.has(name),
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

  it('칸 카드 치수: 모서리 8px, 안쪽 여백 16px, 숫자 카드 큰 숫자 28px, 카드 제목 16px', () => {
    expect(tokens.get('--radius-md')).toBe('8px');
    expect(tokens.get('--space-card')).toBe('1rem');
    expect(tokens.get('--text-kpi')).toBe('1.75rem');
    expect(tokens.get('--text-card-title')).toBe('1rem');
    expect(tokens.get('--shadow-card')).toMatch(/var\(--color-card-shadow\)/);
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
