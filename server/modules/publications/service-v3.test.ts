import { describe, expect, it, vi } from 'vitest';

import { hashPublicationRecipe } from '@/server/domain/publication-recipe';

import { preparePublication } from './service';

const now = new Date('2026-08-16T00:00:00.000Z');

function context(
  target: 'binance-square' | 'x',
  kind: 'post' | 'article',
  options: { protocolVersion?: number; withCover?: boolean } = {},
) {
  const cover = options.withCover
    ? { assetId: 'asset_cover', focalX: 0.5, focalY: 0.4, targetWidth: 1000 as const, targetHeight: 400 as const }
    : undefined;
  return {
    draft: {
      id: `draft_${target}_${kind}`,
      workspaceId: 'workspace_1',
      articleId: 'article_1',
      target,
      kind,
      revision: 2,
      payload: kind === 'post'
        ? { text: 'Text-only post', orderedAssetIds: [] }
        : {
          title: 'Coverless article', markdown: 'A complete body.',
          ...(cover ? { cover } : {}), orderedAssetIds: [],
        },
      expiresAt: new Date('2026-08-16T00:15:00.000Z'),
    },
    assets: cover ? [{
      id: cover.assetId,
      purpose: 'cover_image',
      mimeType: 'image/png' as const,
      sizeBytes: 1_024,
      sha256: 'a'.repeat(64),
    }] : [],
    generatedCoverAssetId: null,
    quota: { articlesPerMonth: 3, imagesPerMonth: 24, maxSlidesPerArticle: 10, publishingEnabled: true },
    device: {
      id: 'device_1', status: 'active' as const, lastSeenAt: now,
      protocolVersion: options.protocolVersion ?? 2,
    },
  };
}

describe('PublicationRecipeV3 preparation', () => {
  it.each([
    ['binance-square', 'post'],
    ['x', 'post'],
    ['binance-square', 'article'],
    ['x', 'article'],
  ] as const)('prepares a zero-media %s %s', async (target, kind) => {
    const repository = {
      loadPreparationContext: vi.fn(async () => context(target, kind)),
      commitPreparedPublication: vi.fn(async () => true),
    };

    const prepared = await preparePublication({
      repository,
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
      articleId: 'article_1',
      target,
      kind,
      expectedRevision: 2,
      commandId: 'command_1',
      now,
    });

    expect(prepared.recipe).toMatchObject({ version: 3, target, kind, assets: [] });
    expect(prepared.recipe).not.toHaveProperty('cover');
    expect(prepared.command).toMatchObject({ target, kind, state: 'queued' });
    expect(prepared.recipeHash).toBe(await hashPublicationRecipe(prepared.recipe));
    expect(repository.loadPreparationContext).toHaveBeenCalledWith(expect.objectContaining({ target, kind }));
    expect(repository.loadPreparationContext).toHaveBeenCalledWith(expect.objectContaining({
      minimumProtocolVersion: 2,
    }));
    expect(repository.commitPreparedPublication).toHaveBeenCalledWith(expect.objectContaining({
      target, kind, recipe: prepared.recipe, command: prepared.command,
    }));
  });

  it('includes an explicitly selected article cover without requiring body images', async () => {
    const repository = {
      loadPreparationContext: vi.fn(async () => context('x', 'article', { withCover: true })),
      commitPreparedPublication: vi.fn(async () => true),
    };

    const prepared = await preparePublication({
      repository,
      actorUserId: 'user_1', workspaceId: 'workspace_1', articleId: 'article_1',
      target: 'x', kind: 'article', expectedRevision: 2, commandId: 'command_1', now,
    });

    expect(prepared.recipe).toMatchObject({
      version: 3,
      target: 'x',
      kind: 'article',
      cover: { assetId: 'asset_cover' },
      orderedAssetIds: [],
      assets: [{ id: 'asset_cover' }],
    });
  });

  it('requires companion protocol V2 before creating a V3 command', async () => {
    const repository = {
      loadPreparationContext: vi.fn(async () => context('x', 'article', { protocolVersion: 1 })),
      commitPreparedPublication: vi.fn(async () => true),
    };

    await expect(preparePublication({
      repository,
      actorUserId: 'user_1', workspaceId: 'workspace_1', articleId: 'article_1',
      target: 'x', kind: 'article', expectedRevision: 2, now,
    })).rejects.toMatchObject({ code: 'PUBLISHER_UPGRADE_REQUIRED', status: 409 });
    expect(repository.commitPreparedPublication).not.toHaveBeenCalled();
  });

  it('upgrades a migrated assetless legacy Binance cover to a coverless V3 Article', async () => {
    const loaded = context('binance-square', 'article');
    loaded.draft.payload = {
      title: 'Migrated article',
      markdown: 'Migrated body',
      cover: { focalX: 0.2, focalY: 0.8, targetWidth: 1000, targetHeight: 400 },
      orderedAssetIds: [],
    };
    const repository = {
      loadPreparationContext: vi.fn(async () => loaded),
      commitPreparedPublication: vi.fn(async () => true),
    };

    const prepared = await preparePublication({
      repository,
      actorUserId: 'user_1', workspaceId: 'workspace_1', articleId: 'article_1',
      target: 'binance-square', kind: 'article', expectedRevision: 2, commandId: 'command_1', now,
    });

    expect(prepared.recipe).toMatchObject({
      version: 3, target: 'binance-square', kind: 'article', title: 'Migrated article',
    });
    expect(prepared.recipe).not.toHaveProperty('cover');
  });
});
