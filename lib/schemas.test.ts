import { describe, expect, it } from 'vitest';

import { DEFAULT_ILLUSTRATION_STYLE } from './config';
import {
  CreateDeckProjectSchema,
  GenerateImagesRequestSchema,
  GenerateRequestSchema,
} from './schemas';

function request(articleContent: string) {
  return {
    articleContent,
    slideCount: 5,
    illustrationStyle: 'pixel-art',
    mode: 'url',
  };
}

describe('GenerateRequestSchema URL mode', () => {
  it('uses Binance Master across generation and project defaults', () => {
    expect(GenerateRequestSchema.parse({
      articleContent: 'A sufficiently long article topic for validation.',
    }).illustrationStyle).toBe(DEFAULT_ILLUSTRATION_STYLE);
    expect(GenerateImagesRequestSchema.parse({}).illustrationStyle)
      .toBe(DEFAULT_ILLUSTRATION_STYLE);
    expect(CreateDeckProjectSchema.parse({
      title: 'Article',
      content: 'A sufficiently long article topic for validation.',
    }).illustrationStyle).toBe(DEFAULT_ILLUSTRATION_STYLE);
  });

  it.each([
    'pixel-art',
    'fantasy-animation',
    'lab-notes',
    'binance',
    'binance-master',
    'binance-briefing',
    'binance-mondo-panoramic',
    'binance-sketch-notes',
    'binance-vector-illustration',
  ] as const)('accepts illustration style %s', (illustrationStyle) => {
    expect(GenerateRequestSchema.parse({
      articleContent: 'A sufficiently long article topic for validation.',
      slideCount: 1,
      illustrationStyle,
      mode: 'prompt',
    }).illustrationStyle).toBe(illustrationStyle);
  });

  it('rejects an unknown illustration style', () => {
    expect(() => GenerateRequestSchema.parse({
      articleContent: 'A sufficiently long article topic for validation.',
      slideCount: 1,
      illustrationStyle: 'binance-blueprint',
      mode: 'prompt',
    })).toThrow();
  });

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
