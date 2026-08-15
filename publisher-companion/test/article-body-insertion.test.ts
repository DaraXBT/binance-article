import { describe, expect, it } from 'bun:test';

import {
  binanceArticleHtmlToText,
  buildBinanceArticleCompositionReport,
  deriveBinanceArticleFinalBodyText,
  isBinanceArticleBodyInserted,
} from '../../.agents/skills/baoyu-post-to-binance-square/scripts/binance-article';
import {
  assertXArticleCompositionReady,
  bindXArticleMediaAsset,
  deriveXArticleFinalBodyText,
  findSingleAddedXArticleMediaSource,
  insertXArticleBodyExactly,
  isXArticleBodyInserted,
  assertXArticleBodyMediaEvidence,
  scopeXArticleBodySnapshot,
  waitForXArticleBodyCleared,
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

    expect(buildBinanceArticleCompositionReport({
      expectedTitle: 'Reviewed title',
      expectedHtml: html,
      imagePlaceholders: [imagePlaceholder],
      codeBlocks: [{ placeholder: codePlaceholder, content: 'const answer = 42;\nreturn answer;' }],
      actualTitle: 'Reviewed title',
      actualBody: 'Before media.\nconst answer = 42;\nreturn answer;\nAfter media.',
      actualImages: 1,
      remainingPlaceholders: [],
      actualCodeBlocks: 1,
    })).toMatchObject({
      titleMatches: true,
      bodyMatches: true,
      expectedImages: 1,
      expectedCodeBlocks: 1,
    });
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

  it('isolates a later attempt after an earlier attempt mutates and throws', async () => {
    let editorText = 'stale';
    let clearCount = 0;

    await insertXArticleBodyExactly({
      expectedText: 'Reviewed article.',
      clear: async () => {
        clearCount += 1;
        editorText = '';
      },
      attempts: [
        async () => {
          editorText = 'partial residue';
          throw new Error('paste event failed');
        },
        async () => { editorText = 'Reviewed article.'; },
      ],
      read: async () => editorText,
    });

    expect(clearCount).toBe(2);
    expect(editorText).toBe('Reviewed article.');
  });

  it('requires a stable empty DraftEditor before an insertion attempt', async () => {
    const values = ['residue', '', ''];
    await expect(waitForXArticleBodyCleared({
      read: async () => values.shift() ?? '',
      wait: async () => undefined,
      maxChecks: 3,
    })).resolves.toBeUndefined();

    await expect(waitForXArticleBodyCleared({
      read: async () => 'residue',
      wait: async () => undefined,
      maxChecks: 3,
    })).rejects.toThrow(/clear/i);
  });

  it('derives the exact final body after rendered image placeholders are removed', () => {
    const html = '<p>Before.</p><p>XIMGPH_1</p><p>After.</p>';
    const expected = deriveXArticleFinalBodyText(html, ['XIMGPH_1']);

    expect(xArticleHtmlToText(html)).toContain('XIMGPH_1');
    expect(isXArticleBodyInserted('Before.\nAfter.', expected)).toBe(true);
    expect(isXArticleBodyInserted('Before.\nXIMGPH_1\nAfter.', expected)).toBe(false);
  });

  it('removes image 1 without corrupting image 10 at the supported boundary', () => {
    const namespace = 'X_1234567890ABCDEF_';
    const first = `${namespace}IMG_1`;
    const tenth = `${namespace}IMG_10`;
    const html = `<p>Before.</p><p>${first}</p><p>Middle.</p><p>${tenth}</p><p>After.</p>`;
    const expected = deriveXArticleFinalBodyText(html, [first, tenth]);

    expect(expected).not.toContain(first);
    expect(expected).not.toContain(tenth);
    expect(isXArticleBodyInserted('Before.\nMiddle.\nAfter.', expected)).toBe(true);
  });
});

describe('X Article ordered media provenance', () => {
  it('identifies exactly one newly inserted source using multiset semantics', () => {
    expect(findSingleAddedXArticleMediaSource(
      ['blob:one'],
      ['blob:one', 'blob:two'],
    )).toBe('blob:two');
    expect(findSingleAddedXArticleMediaSource(
      ['blob:same'],
      ['blob:same', 'blob:same'],
    )).toBe('blob:same');
    expect(() => findSingleAddedXArticleMediaSource([], ['blob:one', 'blob:two']))
      .toThrow(/exactly one/i);
  });
});

describe('X Article fail-closed body media evidence', () => {
  const fingerprintA = {
    aspectRatio: 1.5,
    differenceHash: '0011223344556677',
    colorSamples: [24, 48, 72, 96, 120, 144, 168, 192, 216, 32, 64, 128],
  };
  const reencodedFingerprintA = {
    aspectRatio: 1.5005,
    differenceHash: '0011223344556676',
    colorSamples: [25, 47, 73, 95, 121, 143, 169, 191, 217, 31, 65, 127],
  };
  const fingerprintB = {
    aspectRatio: 0.75,
    differenceHash: 'ffeeddccbbaa9988',
    colorSamples: [220, 190, 160, 130, 100, 70, 40, 20, 10, 230, 200, 170],
  };
  const reviewedTextMediaText = [
    { kind: 'text' as const, text: 'Before the reviewed image.' },
    { kind: 'media' as const, assetId: 'sha256:asset-a' },
    { kind: 'text' as const, text: 'After the reviewed image.' },
  ];
  const verifiedAssetBindings = [
    { blockId: 'atomic-block-a', assetId: 'sha256:asset-a', fingerprint: fingerprintA },
  ];

  it('binds a browser media block only after its decoded fingerprint matches the reviewed asset', () => {
    expect(bindXArticleMediaAsset({
      blockId: 'atomic-block-a',
      assetId: 'sha256:reviewed-file-a',
      reviewedFingerprint: fingerprintA,
      renderedFingerprint: reencodedFingerprintA,
    })).toEqual({
      blockId: 'atomic-block-a',
      assetId: 'sha256:reviewed-file-a',
      fingerprint: fingerprintA,
    });

    expect(() => bindXArticleMediaAsset({
      blockId: 'atomic-block-stale',
      assetId: 'sha256:reviewed-file-b',
      reviewedFingerprint: fingerprintB,
      renderedFingerprint: fingerprintA,
    })).toThrow(/fingerprint|asset|identity/i);
  });

  it('accepts the reviewed text, bound media asset, text sequence', () => {
    expect(() => assertXArticleBodyMediaEvidence({
      reviewedSequence: reviewedTextMediaText,
      renderedSequence: [
        { kind: 'text', text: 'Before the reviewed image.' },
        {
          kind: 'media', blockId: 'atomic-block-a', source: 'blob:initial-a',
          fingerprint: reencodedFingerprintA,
        },
        { kind: 'text', text: 'After the reviewed image.' },
      ],
      verifiedAssetBindings,
    })).not.toThrow();
  });

  it('rejects a reviewed image moved to the end of the article', () => {
    expect(() => assertXArticleBodyMediaEvidence({
      reviewedSequence: reviewedTextMediaText,
      renderedSequence: [
        { kind: 'text', text: 'Before the reviewed image.' },
        { kind: 'text', text: 'After the reviewed image.' },
        {
          kind: 'media', blockId: 'atomic-block-a', source: 'blob:initial-a',
          fingerprint: reencodedFingerprintA,
        },
      ],
      verifiedAssetBindings,
    })).toThrow(/media|sequence|position/i);
  });

  it('rejects a second rendered image that duplicates reviewed asset A instead of B', () => {
    expect(() => assertXArticleBodyMediaEvidence({
      reviewedSequence: [
        { kind: 'text', text: 'First.' },
        { kind: 'media', assetId: 'sha256:asset-a' },
        { kind: 'text', text: 'Between.' },
        { kind: 'media', assetId: 'sha256:asset-b' },
        { kind: 'text', text: 'Last.' },
      ],
      renderedSequence: [
        { kind: 'text', text: 'First.' },
        { kind: 'media', blockId: 'atomic-block-a', source: 'blob:first', fingerprint: fingerprintA },
        { kind: 'text', text: 'Between.' },
        {
          kind: 'media', blockId: 'atomic-block-duplicate-a', source: 'blob:second',
          fingerprint: reencodedFingerprintA,
        },
        { kind: 'text', text: 'Last.' },
      ],
      verifiedAssetBindings: [
        { blockId: 'atomic-block-a', assetId: 'sha256:asset-a', fingerprint: fingerprintA },
        {
          blockId: 'atomic-block-duplicate-a', assetId: 'sha256:asset-a', fingerprint: fingerprintA,
        },
      ],
    })).toThrow(/asset|binding|media/i);
  });

  it('retains verified asset identity when a stable media block URL transitions from blob to https', () => {
    expect(() => assertXArticleBodyMediaEvidence({
      reviewedSequence: reviewedTextMediaText,
      renderedSequence: [
        { kind: 'text', text: 'Before the reviewed image.' },
        {
          kind: 'media', blockId: 'atomic-block-a',
          source: 'https://pbs.twimg.com/media/uploaded-a',
          fingerprint: reencodedFingerprintA,
        },
        { kind: 'text', text: 'After the reviewed image.' },
      ],
      verifiedAssetBindings,
    })).not.toThrow();
  });

  it('excludes media outside the selected article editor from the scoped snapshot', () => {
    expect(scopeXArticleBodySnapshot('article-editor', [
      {
        ownerEditorId: 'article-editor',
        block: { kind: 'text', text: 'Reviewed body.' },
      },
      {
        ownerEditorId: 'sidebar-preview',
        block: {
          kind: 'media', blockId: 'off-editor-media', source: 'blob:sidebar', fingerprint: fingerprintB,
        },
      },
      {
        ownerEditorId: 'article-editor',
        block: {
          kind: 'media', blockId: 'body-media', source: 'blob:body', fingerprint: fingerprintA,
        },
      },
    ])).toEqual([
      { kind: 'text', text: 'Reviewed body.' },
      { kind: 'media', blockId: 'body-media', source: 'blob:body', fingerprint: fingerprintA },
    ]);
  });
});

describe('X Article final composition gate', () => {
  const ready = {
    titleMatches: true,
    bodyMatches: true,
    expectedImages: 1,
    actualImages: 1,
    expectedMediaSources: ['blob:reviewed-1'],
    actualMediaSources: ['blob:reviewed-1'],
    remainingPlaceholders: [] as string[],
    coverRequested: false,
    initialCoverSources: [] as string[],
    actualCoverSources: [] as string[],
  };

  it('accepts only an exact reviewed title, body, media count, and cover state', () => {
    expect(() => assertXArticleCompositionReady(ready)).not.toThrow();
    expect(() => assertXArticleCompositionReady({ ...ready, titleMatches: false }))
      .toThrow(/title/i);
    expect(() => assertXArticleCompositionReady({ ...ready, bodyMatches: false }))
      .toThrow(/body/i);
    expect(() => assertXArticleCompositionReady({ ...ready, actualImages: 0 }))
      .toThrow(/image/i);
    expect(() => assertXArticleCompositionReady({ ...ready, actualImages: 2 }))
      .toThrow(/image/i);
    expect(() => assertXArticleCompositionReady({
      ...ready,
      expectedImages: 2,
      actualImages: 2,
      expectedMediaSources: ['blob:reviewed-1', 'blob:reviewed-2'],
      actualMediaSources: ['blob:reviewed-2', 'blob:reviewed-1'],
    })).toThrow(/media|order/i);
    expect(() => assertXArticleCompositionReady({
      ...ready,
      remainingPlaceholders: ['XIMGPH_1'],
    })).toThrow(/placeholder/i);
    expect(() => assertXArticleCompositionReady({
      ...ready,
      actualCoverSources: ['blob:unexpected-cover'],
    })).toThrow(/cover/i);
    expect(() => assertXArticleCompositionReady({
      ...ready,
      coverRequested: true,
      initialCoverSources: ['blob:stale-cover'],
      actualCoverSources: ['blob:stale-cover'],
    })).toThrow(/cover/i);
    expect(() => assertXArticleCompositionReady({
      ...ready,
      coverRequested: true,
      actualCoverSources: ['blob:new-cover'],
    })).not.toThrow();
  });
});
