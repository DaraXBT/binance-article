import { describe, expect, it, vi } from 'vitest';

import { hashPublicationRecipe } from '@/server/domain/publication-recipe';

import { preparePublication } from './service';

const now = new Date('2026-07-22T00:00:00.000Z');

function base(target: 'binance-square' | 'x') {
  return {
    draft: {
      id: `draft_${target}`,
      workspaceId: 'workspace_1',
      articleId: 'article_1',
      target,
      revision: 2,
      payload: target === 'x'
        ? { text: 'A regular X post', orderedAssetIds: ['asset_1'] }
        : {
          title: 'Article', markdown: 'Body', orderedAssetIds: [],
          cover: { focalX: 0.5, focalY: 0.5, targetWidth: 1000, targetHeight: 400 },
        },
      expiresAt: new Date('2026-07-22T00:15:00.000Z'),
    },
    assets: target === 'x' ? [{
      id: 'asset_1', purpose: 'slide_image', mimeType: 'image/jpeg' as const,
      sizeBytes: 100, sha256: 'a'.repeat(64),
    }] : [],
    generatedCoverAssetId: null,
    quota: { articlesPerMonth: 3, imagesPerMonth: 24, maxSlidesPerArticle: 8, publishingEnabled: true },
    device: { id: 'device_1', status: 'active' as const, lastSeenAt: now },
  };
}

describe('PublicationRecipeV2 preparation', () => {
  it('emits an X-target recipe and immutable target command metadata', async () => {
    const repository = {
      loadPreparationContext: vi.fn(async () => base('x')),
      commitPreparedPublication: vi.fn(async () => true),
    };
    const prepared = await preparePublication({
      repository,
      actorUserId: 'user_1', workspaceId: 'workspace_1', articleId: 'article_1',
      target: 'x', expectedRevision: 2, commandId: 'command_1', now,
    });
    expect(prepared.recipe).toEqual({
      version: 2,
      target: 'x',
      draftId: 'draft_x',
      articleId: 'article_1',
      revision: 2,
      expiresAt: '2026-07-22T00:15:00.000Z',
      text: 'A regular X post',
      orderedAssetIds: ['asset_1'],
      assets: [{ id: 'asset_1', mimeType: 'image/jpeg', sizeBytes: 100, sha256: 'a'.repeat(64) }],
    });
    expect(prepared.recipeHash).toBe(await hashPublicationRecipe(prepared.recipe));
    expect(prepared.command).toMatchObject({ id: 'command_1', target: 'x', state: 'queued' });
    expect(repository.commitPreparedPublication).toHaveBeenCalledWith(expect.objectContaining({
      target: 'x', recipe: prepared.recipe, recipeHash: prepared.recipeHash,
    }));
  });

  it('blocks Binance preparation until the current dedicated cover is generated', async () => {
    await expect(preparePublication({
      repository: {
        loadPreparationContext: vi.fn(async () => base('binance-square')),
        commitPreparedPublication: vi.fn(),
      },
      actorUserId: 'user_1', workspaceId: 'workspace_1', articleId: 'article_1',
      target: 'binance-square', expectedRevision: 2, now,
    })).rejects.toMatchObject({ code: 'PUBLICATION_COVER_NOT_READY', status: 409 });
  });
});
