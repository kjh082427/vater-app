import { describe, expect, it } from 'vitest';
import * as ds from './index';

describe('디자인 시스템 공개 API (화면은 여기서만 가져온다)', () => {
  it('컴포넌트와 숫자 표기 함수를 모두 내보낸다', () => {
    expect(Object.keys(ds).sort()).toEqual(
      [
        'AiText',
        'AppShell',
        'Banner',
        'Button',
        'DECISION_LABEL',
        'DISCLAIMER_ANALYSIS',
        'DISCLAIMER_BASE',
        'DataTable',
        'DecisionScale',
        'Disclaimer',
        'FeedStatus',
        'Icon',
        'MINUS',
        'MISSING',
        'MarketState',
        'PriceChange',
        'Section',
        'SidebarNav',
        'SignedNumber',
        'Sparkline',
        'StatusBar',
        'StatusBarItem',
        'StatusDot',
        'Tab',
        'TabList',
        'TabPanel',
        'Tabs',
        'VisuallyHidden',
        'directionOf',
        'formatEok',
        'formatEokChange',
        'formatNumber',
        'formatPercent',
        'formatPrice',
        'formatPriceChange',
        'formatSigned',
        'formatUsd',
        'formatUsdChange',
        'formatWon',
        'formatWonChange',
      ].sort(),
    );
  });
});
