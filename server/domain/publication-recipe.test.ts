import { describe, expect, it } from 'vitest';

import {
  PUBLICATION_DRAFT_LIFETIME_MS,
  PublicationRecipeV1Schema,
  validatePublicationRecipe,
} from './publication-recipe';

const now = new Date('2026-07-19T00:00:00.000Z');

function validRecipe() {
  return {
    version: 1 as const,
    draftId: 'draft_123',
    articleId: 'article_123',
    revision: 4,
    expiresAt: new Date(now.getTime() + PUBLICATION_DRAFT_LIFETIME_MS).toISOString(),
    title: 'A reviewed Binance Square article',
    markdown: '## Thesis\n\n![Chart](asset:asset_body)',
    cover: {
      assetId: 'asset_cover',
      focalX: 0.5,
      focalY: 0.4,
      targetWidth: 1000 as const,
      targetHeight: 400 as const,
    },
    orderedAssetIds: ['asset_body'],
    assets: [
      {
        id: 'asset_cover',
        role: 'cover' as const,
        mimeType: 'image/png' as const,
        sizeBytes: 1024,
        sha256: 'a'.repeat(64),
      },
      {
        id: 'asset_body',
        role: 'body' as const,
        mimeType: 'image/webp' as const,
        sizeBytes: 2048,
        sha256: 'b'.repeat(64),
      },
    ],
  };
}

describe('PublicationRecipeV1', () => {
  it('contains immutable metadata but no storage credentials or download URLs', () => {
    const recipe = PublicationRecipeV1Schema.parse(validRecipe());

    expect(recipe.version).toBe(1);
    expect(JSON.stringify(recipe)).not.toMatch(/signedUrl|objectKey|credential|token|https?:\/\//i);
  });

  it('accepts a complete unexpired recipe for its exact revision', () => {
    expect(validatePublicationRecipe(validRecipe(), { now, expectedRevision: 4 })).toEqual(validRecipe());
  });

  it('rejects expired or stale recipes', () => {
    expect(() => validatePublicationRecipe(
      { ...validRecipe(), expiresAt: now.toISOString() },
      { now, expectedRevision: 4 },
    )).toThrow(/expired/i);
    expect(() => validatePublicationRecipe(validRecipe(), { now, expectedRevision: 5 })).toThrow(/revision/i);
  });

  it.each([
    ['unknown storage fields', () => ({ ...validRecipe(), signedUrl: 'https://r2.example/secret' })],
    ['duplicate ordered assets', () => ({ ...validRecipe(), orderedAssetIds: ['asset_body', 'asset_body'] })],
    ['missing asset metadata', () => ({ ...validRecipe(), orderedAssetIds: ['asset_missing'] })],
    ['cover absent from metadata', () => ({ ...validRecipe(), assets: validRecipe().assets.slice(1) })],
    ['unsupported MIME type', () => ({
      ...validRecipe(),
      assets: [{ ...validRecipe().assets[0], mimeType: 'image/svg+xml' }, validRecipe().assets[1]],
    })],
  ])('rejects %s', (_name, mutate) => {
    expect(() => PublicationRecipeV1Schema.parse(mutate())).toThrow();
  });
});
