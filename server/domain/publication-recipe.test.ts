import { describe, expect, it } from 'vitest';

import {
  PUBLICATION_DRAFT_LIFETIME_MS,
  PublicationRecipeV2Schema,
  PublicationRecipeV1Schema,
  canonicalizePublicationRecipe,
  hashPublicationRecipe,
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
        mimeType: 'image/png' as const,
        sizeBytes: 1024,
        sha256: 'a'.repeat(64),
      },
      {
        id: 'asset_body',
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

  it('produces a deterministic canonical hash for device revalidation', async () => {
    const recipe = validRecipe();
    const reorderedInput = {
      markdown: recipe.markdown,
      title: recipe.title,
      expiresAt: recipe.expiresAt,
      revision: recipe.revision,
      articleId: recipe.articleId,
      draftId: recipe.draftId,
      version: recipe.version,
      assets: recipe.assets.map((asset) => ({
        sha256: asset.sha256,
        sizeBytes: asset.sizeBytes,
        mimeType: asset.mimeType,
        id: asset.id,
      })),
      orderedAssetIds: recipe.orderedAssetIds,
      cover: {
        targetHeight: recipe.cover.targetHeight,
        targetWidth: recipe.cover.targetWidth,
        focalY: recipe.cover.focalY,
        focalX: recipe.cover.focalX,
        assetId: recipe.cover.assetId,
      },
    };

    expect(canonicalizePublicationRecipe(reorderedInput)).toBe(canonicalizePublicationRecipe(recipe));
    await expect(hashPublicationRecipe(reorderedInput)).resolves.toBe(await hashPublicationRecipe(recipe));
    await expect(hashPublicationRecipe(recipe)).resolves.toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes the recipe hash when publication content or revision changes', async () => {
    const recipe = validRecipe();
    expect(await hashPublicationRecipe({ ...recipe, revision: 5 })).not.toBe(await hashPublicationRecipe(recipe));
    expect(await hashPublicationRecipe({ ...recipe, markdown: `${recipe.markdown}\nchanged` }))
      .not.toBe(await hashPublicationRecipe(recipe));
  });

  it('allows the cover source to remain in the ordered article body', () => {
    const recipe = validRecipe();
    const sharedAsset = recipe.assets[1];
    expect(PublicationRecipeV1Schema.parse({
      ...recipe,
      cover: { ...recipe.cover, assetId: sharedAsset.id },
      assets: [sharedAsset],
      orderedAssetIds: [sharedAsset.id],
    })).toMatchObject({
      cover: { assetId: 'asset_body' },
      orderedAssetIds: ['asset_body'],
    });
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

describe('PublicationRecipeV2', () => {
  it('discriminates Binance Square from a regular X post', () => {
    const legacy = validRecipe();
    expect(PublicationRecipeV2Schema.parse({
      ...legacy,
      version: 2,
      target: 'binance-square',
    })).toMatchObject({ version: 2, target: 'binance-square' });

    expect(PublicationRecipeV2Schema.parse({
      version: 2,
      target: 'x',
      draftId: 'draft_x',
      articleId: 'article_123',
      revision: 2,
      expiresAt: legacy.expiresAt,
      text: 'A regular X post',
      orderedAssetIds: ['asset_body'],
      assets: [legacy.assets[1]],
    })).toMatchObject({ target: 'x', text: 'A regular X post' });
  });

  it('enforces the regular X limits and rejects Binance-only fields', () => {
    const legacy = validRecipe();
    const xRecipe = {
      version: 2,
      target: 'x',
      draftId: 'draft_x',
      articleId: 'article_123',
      revision: 2,
      expiresAt: legacy.expiresAt,
      text: 'x'.repeat(281),
      orderedAssetIds: [],
      assets: [],
    };
    expect(() => PublicationRecipeV2Schema.parse(xRecipe)).toThrow();
    expect(() => PublicationRecipeV2Schema.parse({
      ...xRecipe,
      text: 'post',
      markdown: 'must not be accepted',
    })).toThrow();
    expect(() => PublicationRecipeV2Schema.parse({
      ...xRecipe,
      text: '',
    })).toThrow(/text|image/i);
  });

  it('keeps canonical hashes target-bound', async () => {
    const legacy = validRecipe();
    const binance = { ...legacy, version: 2 as const, target: 'binance-square' as const };
    const x = {
      version: 2 as const,
      target: 'x' as const,
      draftId: legacy.draftId,
      articleId: legacy.articleId,
      revision: legacy.revision,
      expiresAt: legacy.expiresAt,
      text: legacy.markdown,
      orderedAssetIds: legacy.orderedAssetIds,
      assets: legacy.assets.slice(1),
    };
    expect(await hashPublicationRecipe(binance)).not.toBe(await hashPublicationRecipe(x));
  });
});
