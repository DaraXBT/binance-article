import { describe, expect, it } from 'vitest';

import {
  buildArticleSlideAssetUrl,
  extractArticleAssetFilename,
  inferBlobAccess,
} from '@/lib/article-assets';

describe('article asset helpers', () => {
  it('builds inline and download asset URLs from a stored blob reference', () => {
    const imageUrl =
      'https://store-123.private.blob.vercel-storage.com/decks/deck-1/slide-01.png';

    expect(buildArticleSlideAssetUrl('article-1', imageUrl)).toBe(
      '/api/articles/article-1/assets/slide-01.png'
    );
    expect(buildArticleSlideAssetUrl('article-1', imageUrl, { download: true })).toBe(
      '/api/articles/article-1/assets/slide-01.png?download=1'
    );
  });

  it('extracts a stable filename from an encoded blob reference', () => {
    expect(
      extractArticleAssetFilename(
        'https://store-123.public.blob.vercel-storage.com/decks/deck-1/slide%2001.jpeg?download=1'
      )
    ).toBe('slide 01.jpeg');
  });

  it('infers the blob access level from the stored blob host', () => {
    expect(
      inferBlobAccess('https://store-123.private.blob.vercel-storage.com/decks/deck-1/slide-01.png')
    ).toBe('private');
    expect(
      inferBlobAccess('https://store-123.public.blob.vercel-storage.com/decks/deck-1/slide-01.png')
    ).toBe('public');
  });
});
