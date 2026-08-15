import { describe, expect, it, vi } from 'vitest';

import { hashPublicationRecipe } from '@/server/domain/publication-recipe';

import {
  abortPublisherCommand,
  getPublisherCommandStatus,
  loadPublisherRecipe,
} from './service';

const now = new Date('2026-08-16T00:00:00.000Z');

function xArticleRecipe() {
  return {
    version: 3 as const,
    target: 'x' as const,
    kind: 'article' as const,
    draftId: 'draft_x_article',
    articleId: 'article_1',
    revision: 3,
    expiresAt: '2026-08-16T00:15:00.000Z',
    title: 'Title',
    markdown: 'Body',
    orderedAssetIds: [],
    assets: [],
  };
}

describe('kind-aware publisher command service', () => {
  it('loads a V3 recipe only when command target and kind both match', async () => {
    const recipe = xArticleRecipe();
    const recipeHash = await hashPublicationRecipe(recipe);
    const repository = {
      claimNext: vi.fn(), compareAndSwap: vi.fn(), loadStatus: vi.fn(), abort: vi.fn(),
      loadRecipe: vi.fn(async () => ({
        command: {
          id: 'command_1', deviceId: 'device_1', state: 'claimed' as const, revision: 3,
          recipeHash, target: 'x' as const, kind: 'article' as 'article' | 'post',
        },
        recipe,
      })),
    };

    await expect(loadPublisherRecipe({
      repository, deviceId: 'device_1', commandId: 'command_1', now,
    })).resolves.toEqual(recipe);

    repository.loadRecipe.mockResolvedValueOnce({
      command: {
        id: 'command_1', deviceId: 'device_1', state: 'claimed', revision: 3,
        recipeHash, target: 'x', kind: 'post',
      },
      recipe,
    });
    await expect(loadPublisherRecipe({
      repository, deviceId: 'device_1', commandId: 'command_1', now,
    })).rejects.toMatchObject({ code: 'PUBLICATION_RECIPE_MISMATCH', status: 409 });
  });

  it('returns kind in command status metadata', async () => {
    const repository = {
      claimNext: vi.fn(), loadRecipe: vi.fn(), compareAndSwap: vi.fn(), abort: vi.fn(),
      loadStatus: vi.fn(async () => ({
        id: 'command_1', draftId: 'draft_x_article', deviceId: 'device_1',
        target: 'x' as const, kind: 'article' as const, state: 'approved' as const,
        revision: 3, recipeHash: 'a'.repeat(64), expiresAt: new Date('2026-08-16T00:15:00.000Z'),
      })),
    };

    await expect(getPublisherCommandStatus({
      repository, deviceId: 'device_1', commandId: 'command_1', now,
    })).resolves.toMatchObject({ target: 'x', kind: 'article', state: 'approved' });
  });

  it.each(['X_LOGIN_REQUIRED', 'X_ARTICLES_UNAVAILABLE'] as const)(
    'accepts the structured pre-click abort reason %s',
    async (reasonCode) => {
      const repository = {
        claimNext: vi.fn(), loadRecipe: vi.fn(), compareAndSwap: vi.fn(), loadStatus: vi.fn(),
        abort: vi.fn(async () => true),
      };

      await expect(abortPublisherCommand({
        repository,
        deviceId: 'device_1', commandId: 'command_1', revision: 3, reasonCode, now,
      })).resolves.toEqual({ state: 'cancelled' });
      expect(repository.abort).toHaveBeenCalledWith(expect.objectContaining({ reasonCode }));
    },
  );
});
