import { describe, expect, it } from 'vitest';

import { GenerateRequestSchema } from './schemas';

function request(articleContent: string) {
  return {
    articleContent,
    slideCount: 5,
    illustrationStyle: 'pixel-art',
    mode: 'url',
  };
}

describe('GenerateRequestSchema URL mode', () => {
  it.each([
    'http://example.com/article',
    'ftp://example.com/article',
    'https://user@example.com/article',
    'https://user:password@example.com/article',
    'not-a-url-at-all',
    `https://example.com/${'a'.repeat(4_096)}`,
  ])('rejects an unsafe or invalid source URL before job persistence: %s', (value) => {
    expect(() => GenerateRequestSchema.parse(request(value))).toThrow();
  });

  it('accepts a bounded credential-free HTTPS source URL', () => {
    expect(GenerateRequestSchema.parse(request('https://example.com/article#section')))
      .toMatchObject({
        articleContent: 'https://example.com/article',
        mode: 'url',
      });
  });

  it('does not reinterpret ordinary text and prompt modes as URLs', () => {
    expect(GenerateRequestSchema.parse({
      ...request('Write an article about safe account custody.'),
      mode: 'prompt',
    })).toMatchObject({ mode: 'prompt' });
  });
});
