import { describe, expect, it } from 'vitest';
import { withObjectParticle } from './text';

describe('withObjectParticle: 을/를', () => {
  it.each([
    ['삼성전자', '삼성전자를'],
    ['애플', '애플을'],
    ['SK하이닉스', 'SK하이닉스를'],
    ['NAVER', 'NAVER을(를)'],
    ['', ''],
  ])('%s → %s', (word, text) => {
    expect(withObjectParticle(word)).toBe(text);
  });
});
