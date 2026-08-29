import { describe, expect, it } from 'vitest';

import { isArticleSource, normalizeImportUrl } from './article-source';

describe('article source helpers', () => {
  it('accepts only supported workspace sources', () => {
    expect(isArticleSource('prompt')).toBe(true);
    expect(isArticleSource('text')).toBe(true);
    expect(isArticleSource('url')).toBe(true);
    expect(isArticleSource('unknown')).toBe(false);
  });

  it('normalizes safe HTTPS import URLs and removes fragments', () => {
    expect(normalizeImportUrl(' https://example.com/article?ref=home#section '))
      .toBe('https://example.com/article?ref=home');
  });

  it.each([
    'http://example.com/article',
    'https://user:password@example.com/article',
    'not a URL',
  ])('rejects unsafe or invalid import URLs: %s', (value) => {
    expect(normalizeImportUrl(value)).toBeNull();
  });
});
