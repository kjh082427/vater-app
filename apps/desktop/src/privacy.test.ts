import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 개인정보는 어떤 AI 요청에도 넣지 않는다(스펙 v2 8-1장, 최우선). 화면 쪽에서 막을 수 있는 선:
 * AI에 닿는 요청(분석 시작, 브리핑 만들기)을 보내는 코드는 보유 내역·연결·평가를 읽지도 모듈을 가져오지도 않는다.
 * 요청 내용이 실제로 고른 한 종목뿐인지는 화면 시험이 따로 본다(NewAnalysisForm.test.tsx, BriefingScreen.test.tsx).
 */
const here = import.meta.dirname;

function sources(dir: string): { name: string; text: string }[] {
  return readdirSync(join(here, dir), { recursive: true, encoding: 'utf8' })
    .filter((n) => /\.tsx?$/.test(n) && !n.includes('.test.'))
    .map((n) => ({ name: `${dir}/${n}`, text: readFileSync(join(here, dir, n), 'utf8') }));
}

// 분석 화면 전부, 그리고 브리핑을 만드는 목록 화면
const AI_REACHING = [
  ...sources('screens/analysis'),
  {
    name: 'screens/briefing/BriefingsScreen.tsx',
    text: readFileSync(join(here, 'screens/briefing/BriefingsScreen.tsx'), 'utf8'),
  },
];

const FORBIDDEN: [string, RegExp][] = [
  ['보유 화면 모듈', /from ['"][^'"]*\/holdings\//],
  ['보유 내역 API', /['"`]\/holdings/],
  ['평가·추이 API', /['"`]\/portfolio/],
  ['증권사 연결 API', /['"`]\/(connections|brokers)/],
  ['수량·평단가 값', /\b(avg_price|quantity|unpriced_quantity)\b/],
  ['보유 타입', /\b(HoldingOut|SymbolHoldings|PortfolioSummary|ConnectionOut)\b/],
];

describe('AI에 닿는 화면 코드는 보유 내역을 모른다', () => {
  it('검사 대상이 비어 있지 않다', () => {
    expect(AI_REACHING.length).toBeGreaterThan(5);
  });

  it.each(FORBIDDEN)('%s를 쓰지 않는다', (_, pattern) => {
    const hits = AI_REACHING.filter((f) => pattern.test(f.text)).map((f) => f.name);
    expect(hits).toEqual([]);
  });

  it('분석 시작 요청 본문은 market·code·기준일·프리셋뿐이다(AnalysisCreate)', () => {
    const form = readFileSync(join(here, 'screens/analysis/NewAnalysisForm.tsx'), 'utf8');
    const body = /const body: AnalysisCreate = \{([^}]*)\}/.exec(form)?.[1] ?? '';
    expect(body.replace(/\s+/g, ' ').trim()).toBe(
      "market: picked.market === 'US' ? 'US' : 'KR', code: picked.code,",
    );
    const keys = [...form.matchAll(/body\.(\w+) =/g)].map((m) => m[1]);
    expect(keys.sort()).toEqual(['as_of', 'preset']);
  });
});
