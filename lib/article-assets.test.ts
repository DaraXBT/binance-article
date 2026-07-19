import { describe, expect, it } from 'vitest';

import {
  buildArticleSlideAssetUrl,
  createArticleAssetReference,
  extractArticleAssetFilename,
  parseArticleAssetReference,
} from '@/lib/article-assets';

describe('private article asset references', () => {
  it('creates and parses an opaque R2 reference without exposing a bucket URL', () => {
    const reference = createArticleAssetReference('asset_1', 'slide 01.png');

    expect(reference).toBe('r2://article-assets/asset_1/slide%2001.png');
    expect(parseArticleAssetReference(reference)).toEqual({
      assetId: 'asset_1', filename: 'slide 01.png',
    });
    expect(reference).not.toMatch(/r2\.dev|https?:/);
  });

  it('builds inline and download URLs through the authenticated article endpoint', () => {
    const reference = createArticleAssetReference('asset_1', 'slide-01.png');
    expect(buildArticleSlideAssetUrl('article-1', reference)).toBe(
      '/api/articles/article-1/assets/slide-01.png',
    );
    expect(buildArticleSlideAssetUrl('article-1', reference, { download: true })).toBe(
      '/api/articles/article-1/assets/slide-01.png?download=1',
    );
    expect(extractArticleAssetFilename(reference)).toBe('slide-01.png');
  });

  it('rejects legacy provider URLs, path traversal, and malformed references', () => {
    expect(() => parseArticleAssetReference(
      'https://store.private.blob.vercel-storage.com/decks/a/slide.png',
    )).toThrow(/private article asset reference/i);
    expect(() => parseArticleAssetReference('r2://other/asset_1/slide.png')).toThrow();
    expect(() => createArticleAssetReference('asset_1', '../slide.png')).toThrow();
    expect(() => createArticleAssetReference('', 'slide.png')).toThrow();
  });
});
