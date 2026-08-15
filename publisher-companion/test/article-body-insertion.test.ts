import { describe, expect, it } from 'bun:test';

import {
  binanceArticleHtmlToText,
  deriveBinanceArticleFinalBodyText,
  isBinanceArticleBodyInserted,
} from '../../.agents/skills/baoyu-post-to-binance-square/scripts/binance-article';
import {
  assertXArticleCompositionReady,
  deriveXArticleFinalBodyText,
  insertXArticleBodyExactly,
  isXArticleBodyInserted,
  xArticleHtmlToText,
} from '../../.agents/skills/baoyu-post-to-x/scripts/x-article';

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

  it('rejects a long article truncated after the matching prefix', () => {
    const expected = 'A reviewed article begins with this exact prefix and continues to its conclusion.';

    expect(isInserted(expected.slice(0, 40), expected)).toBe(false);
  });

  it('rejects equal-length corruption after the matching prefix', () => {
    const expected = 'A reviewed article begins with this exact prefix and continues to its conclusion.';
    const corrupted = `${expected.slice(0, 40)}${'x'.repeat(expected.length - 40)}`;

    expect(isInserted(corrupted, expected)).toBe(false);
  });

  it('rejects a body inserted more than once', () => {
    const expected = 'A complete reviewed article body.';

    expect(isInserted(`${expected}\n\n${expected}`, expected)).toBe(false);
  });
});

describe('Binance Article rendered-body expectations', () => {
  it('preserves boundaries between adjacent rendered blocks', () => {
    expect(binanceArticleHtmlToText('<p>First paragraph.</p><p>Second paragraph.</p>'))
      .toBe('First paragraph.\nSecond paragraph.');
  });

  it('removes image placeholders and replaces code placeholders with rendered code', () => {
    const imagePlaceholder = 'BS_1234567890ABCDEF_IMG_1';
    const codePlaceholder = 'BS_1234567890ABCDEF_CODE_1';
    const html = [
      '<p>Before media.</p>',
      `<p>${imagePlaceholder}</p>`,
      `<p>${codePlaceholder}</p>`,
      '<p>After media.</p>',
    ].join('');
    const expected = deriveBinanceArticleFinalBodyText(
      html,
      [imagePlaceholder],
      [{ placeholder: codePlaceholder, content: 'const answer = 42;\nreturn answer;' }],
    );

    expect(expected).not.toContain(imagePlaceholder);
    expect(expected).not.toContain(codePlaceholder);
    expect(isBinanceArticleBodyInserted(
      'Before media.\nconst answer = 42;\nreturn answer;\nAfter media.',
      expected,
    )).toBe(true);
    expect(isBinanceArticleBodyInserted(
      'Before media.\nconst answer = 41;\nreturn answer.\nAfter media.',
      expected,
    )).toBe(false);
  });
});

describe('X Article exact body insertion', () => {
  it('clears partial residue before a later insertion attempt succeeds', async () => {
    const events: string[] = [];
    let editorText = 'stale draft';

    await insertXArticleBodyExactly({
      expectedText: 'Complete reviewed article.',
      clear: async () => {
        events.push('clear');
        editorText = '';
      },
      attempts: [
        async () => {
          events.push('partial');
          editorText += 'Complete reviewed';
        },
        async () => {
          events.push('complete');
          editorText += 'Complete reviewed article.';
        },
      ],
      read: async () => {
        events.push('read');
        return editorText;
      },
    });

    expect(editorText).toBe('Complete reviewed article.');
    expect(events).toEqual([
      'clear', 'partial', 'read',
      'clear', 'complete', 'read',
    ]);
  });

  it('rejects duplicated residue even when an insertion attempt reports success', async () => {
    let editorText = '';
    const clear = async () => { editorText = ''; };

    await expect(insertXArticleBodyExactly({
      expectedText: 'Reviewed article.',
      clear,
      attempts: [async () => { editorText = 'Reviewed article. Reviewed article.'; }],
      read: async () => editorText,
    })).rejects.toThrow(/exact reviewed body/i);
  });

  it('clears before every failed attempt and throws after the final mismatch', async () => {
    const events: string[] = [];

    await expect(insertXArticleBodyExactly({
      expectedText: 'Reviewed article.',
      clear: async () => { events.push('clear'); },
      attempts: [
        async () => { events.push('first'); },
        async () => { events.push('second'); },
        async () => { events.push('manual'); },
      ],
      read: async () => {
        events.push('read');
        return 'still incomplete';
      },
    })).rejects.toThrow(/exact reviewed body/i);

    expect(events).toEqual([
      'clear', 'first', 'read',
      'clear', 'second', 'read',
      'clear', 'manual', 'read',
    ]);
  });

  it('derives the exact final body after rendered image placeholders are removed', () => {
    const html = '<p>Before.</p><p>XIMGPH_1</p><p>After.</p>';
    const expected = deriveXArticleFinalBodyText(html, ['XIMGPH_1']);

    expect(xArticleHtmlToText(html)).toContain('XIMGPH_1');
    expect(isXArticleBodyInserted('Before.\nAfter.', expected)).toBe(true);
    expect(isXArticleBodyInserted('Before.\nXIMGPH_1\nAfter.', expected)).toBe(false);
  });
});

describe('X Article final composition gate', () => {
  const ready = {
    titleMatches: true,
    bodyMatches: true,
    expectedImages: 1,
    actualImages: 1,
    remainingPlaceholders: [] as string[],
    expectedCover: false,
    actualCover: false,
  };

  it('accepts only an exact reviewed title, body, media count, and cover state', () => {
    expect(() => assertXArticleCompositionReady(ready)).not.toThrow();
    expect(() => assertXArticleCompositionReady({ ...ready, bodyMatches: false }))
      .toThrow(/body/i);
    expect(() => assertXArticleCompositionReady({ ...ready, actualImages: 0 }))
      .toThrow(/image/i);
    expect(() => assertXArticleCompositionReady({
      ...ready,
      remainingPlaceholders: ['XIMGPH_1'],
    })).toThrow(/placeholder/i);
    expect(() => assertXArticleCompositionReady({
      ...ready,
      expectedCover: true,
      actualCover: false,
    })).toThrow(/cover/i);
  });
});
