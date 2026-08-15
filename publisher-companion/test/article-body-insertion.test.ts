import { describe, expect, it } from 'bun:test';

import { isBinanceArticleBodyInserted } from '../../.agents/skills/baoyu-post-to-binance-square/scripts/binance-article';
import { isXArticleBodyInserted } from '../../.agents/skills/baoyu-post-to-x/scripts/x-article';

describe.each([
  ['X', isXArticleBodyInserted],
  ['Binance', isBinanceArticleBodyInserted],
] as const)('%s Article body insertion detection', (_platform, isInserted) => {
  it('accepts a complete text-only article shorter than 50 characters', () => {
    expect(isInserted('A short text-only article.', 'A short text-only article.')).toBe(true);
  });

  it('normalizes editor whitespace before comparing the expected text', () => {
    expect(isInserted('First line\n\nSecond line', 'First line Second line')).toBe(true);
  });

  it('rejects empty or truncated short content', () => {
    expect(isInserted('', 'A short article.')).toBe(false);
    expect(isInserted('A short', 'A short article.')).toBe(false);
  });
});
