import { describe, expect, it, vi } from 'vitest';

import { hashPublicationRecipe } from '@/server/domain/publication-recipe';

import {
  PUBLISHER_DEVICE_ONLINE_WINDOW_MS,
  prepareBinancePublication,
} from './service';

const now = new Date('2026-07-19T00:00:00.000Z');

function context(overrides: Record<string, unknown> = {}) {
  return {
    draft: {
      id: 'draft_1',
      workspaceId: 'workspace_1',
      articleId: 'article_1',
      revision: 3,
      title: 'Reviewed article',
      markdown: '## Thesis\n\n![Chart](asset:asset_1)',
      cover: {
        assetId: 'asset_1', focalX: 0.5, focalY: 0.5, targetWidth: 1000 as const, targetHeight: 400 as const,
      },
      orderedAssetIds: ['asset_1'],
      expiresAt: new Date('2026-07-19T00:15:00.000Z'),
    },
    assets: [{
      id: 'asset_1',
      mimeType: 'image/png' as const,
      sizeBytes: 2048,
      sha256: 'a'.repeat(64),
    }],
    quota: {
      articlesPerMonth: 3,
      imagesPerMonth: 24,
      maxSlidesPerArticle: 8,
      publishingEnabled: true,
    },
    device: {
      id: 'device_1',
      status: 'active' as const,
      lastSeenAt: new Date(now.getTime() - PUBLISHER_DEVICE_ONLINE_WINDOW_MS + 1),
    },
    ...overrides,
  };
}

function repository(overrides: Record<string, unknown> = {}) {
  return {
    loadPreparationContext: vi.fn(async () => context()),
    commitPreparedPublication: vi.fn(async () => true),
    ...overrides,
  };
}

describe('prepareBinancePublication', () => {
  it('creates a revision-bound recipe and queued command for the active local device', async () => {
    const repo = repository();
    const result = await prepareBinancePublication({
      repository: repo,
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
      articleId: 'article_1',
      expectedRevision: 3,
      commandId: 'command_1',
      now,
    });

    expect(result.recipe).toMatchObject({
      version: 1,
      draftId: 'draft_1',
      articleId: 'article_1',
      revision: 3,
      title: 'Reviewed article',
      orderedAssetIds: ['asset_1'],
      assets: [{ id: 'asset_1', mimeType: 'image/png', sizeBytes: 2048, sha256: 'a'.repeat(64) }],
    });
    expect(result.recipeHash).toBe(await hashPublicationRecipe(result.recipe));
    expect(result.command).toEqual({
      id: 'command_1',
      draftId: 'draft_1',
      deviceId: 'device_1',
      state: 'queued',
      revision: 3,
      recipeHash: result.recipeHash,
      expiresAt: new Date('2026-07-19T00:15:00.000Z'),
    });
    expect(repo.commitPreparedPublication).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
      expectedRevision: 3,
      recipeHash: result.recipeHash,
      command: result.command,
    }));
    expect(JSON.stringify(result)).not.toMatch(/r2Key|signedUrl|credential|cookie|chromeProfile/i);
  });

  it.each([
    ['publishing disabled', context({ quota: { ...context().quota, publishingEnabled: false } }), 'PUBLISHING_DISABLED'],
    ['no paired device', context({ device: null }), 'PUBLISHER_DEVICE_OFFLINE'],
    ['offline device', context({
      device: { id: 'device_1', status: 'active', lastSeenAt: new Date(now.getTime() - PUBLISHER_DEVICE_ONLINE_WINDOW_MS) },
    }), 'PUBLISHER_DEVICE_OFFLINE'],
    ['revoked device', context({
      device: { id: 'device_1', status: 'revoked', lastSeenAt: now },
    }), 'PUBLISHER_DEVICE_OFFLINE'],
  ])('rejects %s', async (_label, loaded, code) => {
    await expect(prepareBinancePublication({
      repository: repository({ loadPreparationContext: vi.fn(async () => loaded) }),
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
      articleId: 'article_1',
      expectedRevision: 3,
      commandId: 'command_1',
      now,
    })).rejects.toMatchObject({ code });
  });

  it('rejects missing/cross-workspace asset metadata and stale drafts', async () => {
    await expect(prepareBinancePublication({
      repository: repository({
        loadPreparationContext: vi.fn(async () => context({ assets: [] })),
      }),
      actorUserId: 'user_1', workspaceId: 'workspace_1', articleId: 'article_1',
      expectedRevision: 3, commandId: 'command_1', now,
    })).rejects.toMatchObject({ code: 'PUBLICATION_ASSET_MISSING' });

    await expect(prepareBinancePublication({
      repository: repository({ commitPreparedPublication: vi.fn(async () => false) }),
      actorUserId: 'user_1', workspaceId: 'workspace_1', articleId: 'article_1',
      expectedRevision: 3, commandId: 'command_1', now,
    })).rejects.toMatchObject({ code: 'PUBLICATION_REVISION_STALE' });
  });

  it('enforces the per-user and global ten-slide caps', async () => {
    const ids = Array.from({ length: 9 }, (_, index) => `asset_${index}`);
    const assets = ids.map((id, index) => ({
      id, mimeType: 'image/png' as const, sizeBytes: 100 + index, sha256: index.toString(16).padStart(64, '0'),
    }));
    await expect(prepareBinancePublication({
      repository: repository({
        loadPreparationContext: vi.fn(async () => context({
          draft: { ...context().draft, cover: { ...context().draft.cover, assetId: ids[0] }, orderedAssetIds: ids },
          assets,
        })),
      }),
      actorUserId: 'user_1', workspaceId: 'workspace_1', articleId: 'article_1',
      expectedRevision: 3, commandId: 'command_1', now,
    })).rejects.toMatchObject({ code: 'SLIDE_LIMIT' });
  });
});
