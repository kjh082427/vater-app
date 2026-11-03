import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// 화면 CSS도 디자인 시스템 규칙을 따른다(DESIGN.md "역할 이름 Rule"): 색 값을 직접 쓰지 않고,
// 쓰는 토큰은 모두 tokens.css에 있어야 한다. 새 색이 필요하면 ui/design-system-* 브랜치에서 토큰으로 더한다.
const src = join(import.meta.dirname, '..');
const tokensCss = readFileSync(join(src, 'design-system/tokens.css'), 'utf8');
const defined = new Set([...tokensCss.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));

function cssFiles(): string[] {
  return ['app', 'screens'].flatMap((dir) => {
    const root = join(src, dir);
    if (!existsSync(root)) return [];
    return readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.css'))
      .map((name) => join(root, name));
  });
}

describe('화면 CSS', () => {
  it('색 값을 직접 쓰지 않는다', () => {
    const offenders = cssFiles().flatMap((path) => {
      const css = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      const hits = css.match(
        /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(|\b(?:red|blue|green)\b/g,
      );
      return (hits ?? []).map((hit) => `${path.slice(src.length + 1)}: ${hit}`);
    });
    expect(offenders).toEqual([]);
  });

  it('쓰는 var(--*)는 모두 tokens.css에 있다', () => {
    const missing = cssFiles().flatMap((path) =>
      [...readFileSync(path, 'utf8').matchAll(/var\((--[\w-]+)/g)]
        .map((m) => m[1] as string)
        .filter((name) => !defined.has(name))
        .map((name) => `${path.slice(src.length + 1)}: ${name}`),
    );
    expect(missing).toEqual([]);
  });

  it('검사 대상이 있다', () => {
    expect(cssFiles().length).toBeGreaterThan(0);
  });
});
