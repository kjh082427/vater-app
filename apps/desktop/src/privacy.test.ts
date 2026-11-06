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

const file = (name: string) => ({ name, text: readFileSync(join(here, name), 'utf8') });

// 분석 화면 전부, 브리핑을 만드는 목록 화면, 브리핑 AI 해석을 다시 만드는 부품(21장 5번)
const AI_REACHING = [
  ...sources('screens/analysis'),
  file('screens/briefing/BriefingsScreen.tsx'),
  file('screens/briefing/InterpretRetry.tsx'),
];

/**
 * 분석 창이 보유 종목에서 고르기에 쓰는 단 하나의 예외(21장 3번). 이 부품은 고른 종목의
 * market·code·name만 돌려주고(아래 시험), 분석 화면은 그 밖의 보유 모듈을 가져오지 않는다.
 */
const HELD_PICK_IMPORT = "import { HeldSymbolChoices } from '../holdings/HeldSymbolChoices';";
const withoutAllowed = (text: string) => text.replace(HELD_PICK_IMPORT, '');

const FORBIDDEN: [string, RegExp][] = [
  ['보유 화면 모듈', /from ['"][^'"]*\/holdings\//],
  ['보유 내역 API', /['"`]\/holdings/],
  ['평가·추이 API', /['"`]\/portfolio/],
  ['증권사 연결 API', /['"`]\/(connections|brokers)/],
  ['수량·평단가 값', /\b(avg_price|quantity|unpriced_quantity)\b/],
  ['보유 타입', /\b(HoldingOut|SymbolHoldings|PortfolioSummary|ConnectionOut)\b/],
  ['내 자산 값', /\b(MyAssets|my_assets)\b/],
];

describe('AI에 닿는 화면 코드는 보유 내역을 모른다', () => {
  it('검사 대상이 비어 있지 않다', () => {
    expect(AI_REACHING.length).toBeGreaterThan(5);
  });

  it.each(FORBIDDEN)('%s를 쓰지 않는다', (_, pattern) => {
    const hits = AI_REACHING.filter((f) => pattern.test(withoutAllowed(f.text))).map((f) => f.name);
    expect(hits).toEqual([]);
  });

  it('보유 종목 고르기 부품만 예외이고, 분석 화면에서 쓰는 곳은 NewAnalysisForm 하나다', () => {
    const using = AI_REACHING.filter((f) => f.text.includes(HELD_PICK_IMPORT)).map((f) => f.name);
    expect(using).toEqual(['screens/analysis/NewAnalysisForm.tsx']);
    const importsOfHoldings = AI_REACHING.flatMap((f) =>
      [...f.text.matchAll(/from ['"][^'"]*\/holdings\/[^'"]*['"]/g)].map(
        (m) => `${f.name} ${m[0]}`,
      ),
    );
    expect(importsOfHoldings).toEqual([
      "screens/analysis/NewAnalysisForm.tsx from '../holdings/HeldSymbolChoices'",
    ]);
  });

  it('HeldSymbolChoices는 고른 종목의 market·code·name만 밖으로 넘긴다', () => {
    const text = readFileSync(join(here, 'screens/holdings/HeldSymbolChoices.tsx'), 'utf8');
    const picks = [...text.matchAll(/onPick\(([^)]*)\)/g)].map((m) =>
      m[1]?.replace(/\s+/g, ' ').trim(),
    );
    expect(picks).toEqual(['{ market: s.market, code: s.code, name: s.name }']);
    expect(text).not.toMatch(/\bonPick:[^;]*(quantity|avg_price|broker)/);
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

  it('/briefings로 POST하는 호출은 InterpretRetry(본문 없음)와 BriefingsScreen(시장만) 둘뿐이다', () => {
    const posting = sources('.').filter((f) =>
      /['"`]\/briefings[^'"`]*['"`][^;]{0,200}method:\s*['"]POST['"]/s.test(f.text),
    );
    expect(posting.map((f) => f.name).sort()).toEqual([
      './screens/briefing/BriefingsScreen.tsx',
      './screens/briefing/InterpretRetry.tsx',
    ]);
    const retry = file('screens/briefing/InterpretRetry.tsx').text;
    expect(retry).toMatch(
      /api\.request\(`\/briefings\/\$\{b\.id\}\/interpret`, \{ method: 'POST' \}\)/,
    );
    expect(retry).not.toMatch(/\bbody:/);
  });

  it('/analyses로 POST하는 호출은 소스 전체에서 찾아 보유 필드가 없는지 본다', () => {
    // 화면 폴더가 아니어도(대시보드, 앱 껍데기 등) 분석을 시작·재시도·취소하는 코드는 같은 기준을 받는다
    const posting = sources('.').filter((f) =>
      /['"`]\/analyses[^'"`]*['"`][^;]{0,200}method:\s*['"]POST['"]/s.test(f.text),
    );
    expect(posting.map((f) => f.name)).toEqual(
      expect.arrayContaining([
        './screens/analysis/NewAnalysisForm.tsx',
        './screens/analysis/AnalysisDetailScreen.tsx',
      ]),
    );
    for (const [what, pattern] of FORBIDDEN) {
      expect(
        posting
          .filter((f) => pattern.test(withoutAllowed(f.text)))
          .map((f) => `${f.name}: ${what}`),
      ).toEqual([]);
    }
  });
});
