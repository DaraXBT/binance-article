import { describe, expect, it } from 'vitest';

import {
  PublicationRecipeSchema,
  canonicalizePublicationRecipe,
  hashPublicationRecipe,
} from './publication-recipe';

const expiresAt = '2026-08-16T00:15:00.000Z';

const bodyAsset = {
  id: 'asset_body',
  mimeType: 'image/webp' as const,
  sizeBytes: 2_048,
  sha256: 'b'.repeat(64),
};

const coverAsset = {
  id: 'asset_cover',
  mimeType: 'image/png' as const,
  sizeBytes: 1_024,
  sha256: 'a'.repeat(64),
};

function common(target: 'binance-square' | 'x', kind: 'post' | 'article') {
  return {
    version: 3 as const,
    target,
    kind,
    draftId: `draft_${target}_${kind}`,
    articleId: 'article_123',
    revision: 4,
    expiresAt,
  };
}

function mediaFreePost(target: 'binance-square' | 'x') {
  return {
    ...common(target, 'post'),
    text: `${target} text-only post`,
    orderedAssetIds: [],
    assets: [],
  };
}

function mediaFreeArticle(target: 'binance-square' | 'x') {
  return {
    ...common(target, 'article'),
    title: `${target} coverless article`,
    markdown: '## A complete article without media',
    orderedAssetIds: [],
    assets: [],
  };
}

describe('PublicationRecipeV3', () => {
  it.each([
    ['binance-square', 'post'],
    ['x', 'post'],
  ] as const)('accepts a media-free %s %s', (target, _kind) => {
    const recipe = mediaFreePost(target);

    expect(PublicationRecipeSchema.parse(recipe)).toEqual(recipe);
  });

  it.each([
    ['binance-square', 'article'],
    ['x', 'article'],
  ] as const)('accepts a coverless, body-image-free %s %s', (target, _kind) => {
    const recipe = mediaFreeArticle(target);

    const parsed = PublicationRecipeSchema.parse(recipe);
    expect(parsed).toEqual(recipe);
    expect(parsed).not.toHaveProperty('cover');
  });

  it.each(['binance-square', 'x'] as const)('accepts an image-only %s post', (target) => {
    const recipe = {
      ...mediaFreePost(target),
      text: '',
      orderedAssetIds: [bodyAsset.id],
      assets: [bodyAsset],
    };

    expect(PublicationRecipeSchema.parse(recipe)).toEqual(recipe);
  });

  it.each(['binance-square', 'x'] as const)(
    'keeps the cover and body images independently optional for a %s article',
    (target) => {
      const bodyOnly = {
        ...mediaFreeArticle(target),
        markdown: `Body\n\n![Chart](asset:${bodyAsset.id})`,
        orderedAssetIds: [bodyAsset.id],
        assets: [bodyAsset],
      };
      const coverOnly = {
        ...mediaFreeArticle(target),
        cover: {
          assetId: coverAsset.id,
          focalX: 0.5,
          focalY: 0.4,
          targetWidth: 1000 as const,
          targetHeight: 400 as const,
        },
        assets: [coverAsset],
      };

      expect(PublicationRecipeSchema.parse(bodyOnly)).toEqual(bodyOnly);
      expect(PublicationRecipeSchema.parse(coverOnly)).toEqual(coverOnly);
    },
  );

  it('supports Binance post text up to 2,100 characters while retaining the X 280-character limit', () => {
    expect(PublicationRecipeSchema.safeParse({
      ...mediaFreePost('binance-square'),
      text: 'b'.repeat(2_100),
    }).success).toBe(true);
    expect(PublicationRecipeSchema.safeParse({
      ...mediaFreePost('binance-square'),
      text: 'b'.repeat(2_101),
    }).success).toBe(false);
    expect(PublicationRecipeSchema.safeParse({
      ...mediaFreePost('x'),
      text: 'x'.repeat(280),
    }).success).toBe(true);
    expect(PublicationRecipeSchema.safeParse({
      ...mediaFreePost('x'),
      text: 'x'.repeat(281),
    }).success).toBe(false);
  });

  it.each([
    ['empty post', { ...mediaFreePost('x'), text: '' }],
    ['article without title', { ...mediaFreeArticle('x'), title: '' }],
    ['article without body', { ...mediaFreeArticle('x'), markdown: '' }],
    ['post with article fields', { ...mediaFreePost('x'), title: 'Wrong', markdown: 'Wrong' }],
    ['article with post fields', { ...mediaFreeArticle('x'), text: 'Wrong' }],
    ['article with a null cover', { ...mediaFreeArticle('x'), cover: null }],
    ['article with dangling cover metadata', {
      ...mediaFreeArticle('x'),
      cover: {
        assetId: 'missing', focalX: 0.5, focalY: 0.5, targetWidth: 1000, targetHeight: 400,
      },
    }],
    ['article with a dangling Markdown asset', {
      ...mediaFreeArticle('x'), markdown: '![Missing](asset:missing)',
    }],
  ])('rejects %s', (_name, recipe) => {
    expect(PublicationRecipeSchema.safeParse(recipe).success).toBe(false);
  });

  it.each([
    ['missing selected image', 'Body without the selected image.'],
    ['duplicate selected image', '![One](asset:asset_body)\n\n![Two](asset:asset_body)'],
    ['external image', '![One](asset:asset_body)\n\n![External](https://example.invalid/x.png)'],
    ['reference-style image', '![One](asset:asset_body)\n\n![External][ref]\n[ref]: /etc/x.png'],
    ['raw HTML image', '![One](asset:asset_body)\n\n<img src="/etc/x.png">'],
    ['code-hidden image', '![One](asset:asset_body)\n\n`![Hidden](/etc/x.png)`'],
  ])('rejects V3 Article Markdown with a %s', (_name, markdown) => {
    expect(PublicationRecipeSchema.safeParse({
      ...mediaFreeArticle('x'),
      markdown,
      orderedAssetIds: [bodyAsset.id],
      assets: [bodyAsset],
    }).success).toBe(false);
  });

  it('exports the post/article kind schema as part of the domain contract', async () => {
    const publicationRecipe = await import('./publication-recipe');
    const kindSchema = (publicationRecipe as unknown as Record<string, {
      parse?: (input: unknown) => unknown;
    }>).PublicationKindSchema;

    expect(kindSchema?.parse?.('post')).toBe('post');
    expect(kindSchema?.parse?.('article')).toBe('article');
    expect(() => kindSchema?.parse?.('thread')).toThrow();
  });

  it('binds target and kind into canonical V3 hashes', async () => {
    const xPost = mediaFreePost('x');
    const binancePost = mediaFreePost('binance-square');
    const xArticle = mediaFreeArticle('x');

    expect(canonicalizePublicationRecipe(xPost)).toContain('"kind":"post"');
    expect(await hashPublicationRecipe(xPost)).not.toBe(await hashPublicationRecipe(binancePost));
    expect(await hashPublicationRecipe(xPost)).not.toBe(await hashPublicationRecipe(xArticle));
  });
});

describe('legacy publication recipe hash compatibility', () => {
  const v1 = {
    version: 1 as const,
    draftId: 'draft_123',
    articleId: 'article_123',
    revision: 4,
    expiresAt: '2026-07-19T00:15:00.000Z',
    title: 'A reviewed Binance Square article',
    markdown: '## Thesis\n\n![Chart](asset:asset_body)',
    cover: {
      assetId: coverAsset.id,
      focalX: 0.5,
      focalY: 0.4,
      targetWidth: 1000 as const,
      targetHeight: 400 as const,
    },
    orderedAssetIds: [bodyAsset.id],
    assets: [coverAsset, bodyAsset],
  };

  it('does not rewrite V1 or V2 canonical hashes when V3 is introduced', async () => {
    await expect(hashPublicationRecipe(v1)).resolves.toBe(
      '7e0fdad308ba7e77ee53c050162f3cbd88b369092b214b26fbf36072d0bb679e',
    );
    await expect(hashPublicationRecipe({
      ...v1,
      version: 2,
      target: 'binance-square',
    })).resolves.toBe('50d77fe38aee54597d782703ad8f9e597fc58f0c6fa9ce819d539cac391b12fe');
    await expect(hashPublicationRecipe({
      version: 2,
      target: 'x',
      draftId: 'draft_x',
      articleId: 'article_123',
      revision: 2,
      expiresAt: v1.expiresAt,
      text: 'A regular X post',
      orderedAssetIds: [bodyAsset.id],
      assets: [bodyAsset],
    })).resolves.toBe('8a260f97ed9327981688c10c31ffd9a8f1a97f90110d4b21dd77dea83da4fe75');
  });
});
