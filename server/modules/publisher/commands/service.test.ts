import { describe, expect, it, vi } from 'vitest';

import { hashPublicationRecipe } from '@/server/domain/publication-recipe';

import {
  beginDevicePublish,
  claimNextPublisherCommand,
  loadPublisherRecipe,
  getPublisherCommandStatus,
  abortPublisherCommand,
  reportEditorReady,
  reportPublishResult,
} from './service';

const now = new Date('2026-07-19T00:00:00.000Z');

function recipe() {
  return {
    version: 1 as const,
    draftId: 'draft_1',
    articleId: 'article_1',
    revision: 3,
    expiresAt: '2026-07-19T00:15:00.000Z',
    title: 'Title',
    markdown: '## Body',
    cover: { assetId: 'asset_1', focalX: 0.5, focalY: 0.5, targetWidth: 1000 as const, targetHeight: 400 as const },
    orderedAssetIds: ['asset_1'],
    assets: [{ id: 'asset_1', mimeType: 'image/png' as const, sizeBytes: 100, sha256: 'a'.repeat(64) }],
  };
}

function repository(overrides: Record<string, unknown> = {}) {
  return {
    claimNext: vi.fn(async () => ({
      id: 'command_1', draftId: 'draft_1', deviceId: 'device_1', state: 'claimed' as const,
      revision: 3, recipeHash: 'a'.repeat(64), expiresAt: new Date('2026-07-19T00:15:00.000Z'),
    })),
    loadRecipe: vi.fn(async () => null),
    loadStatus: vi.fn(async () => ({
      id: 'command_1', draftId: 'draft_1', deviceId: 'device_1', target: 'binance-square' as const,
      state: 'publishing' as const, revision: 3, recipeHash: 'a'.repeat(64),
      expiresAt: new Date('2026-07-19T00:15:00.000Z'),
    })),
    abort: vi.fn(async () => true),
    compareAndSwap: vi.fn(async () => true),
    ...overrides,
  };
}

describe('publisher command service', () => {
  it('claims at most one queued command for the authenticated device', async () => {
    const repo = repository();
    await expect(claimNextPublisherCommand({
      repository: repo, deviceId: 'device_1', now,
    })).resolves.toMatchObject({ id: 'command_1', state: 'claimed' });
    expect(repo.claimNext).toHaveBeenCalledWith({ deviceId: 'device_1', now });
  });

  it('returns null when the long-poll cycle has no command', async () => {
    await expect(claimNextPublisherCommand({
      repository: repository({ claimNext: vi.fn(async () => null) }), deviceId: 'device_1', now,
    })).resolves.toBeNull();
  });

  it('returns a schema-valid recipe only when its canonical hash and revision match', async () => {
    const value = recipe();
    const recipeHash = await hashPublicationRecipe(value);
    const repo = repository({
      loadRecipe: vi.fn(async () => ({
        command: { id: 'command_1', deviceId: 'device_1', state: 'claimed', revision: 3, recipeHash },
        recipe: value,
      })),
    });
    await expect(loadPublisherRecipe({
      repository: repo, deviceId: 'device_1', commandId: 'command_1', now,
    })).resolves.toEqual(value);

    await expect(loadPublisherRecipe({
      repository: repository({
        loadRecipe: vi.fn(async () => ({
          command: { id: 'command_1', deviceId: 'device_1', state: 'claimed', revision: 3, recipeHash: 'b'.repeat(64) },
          recipe: value,
        })),
      }),
      deviceId: 'device_1', commandId: 'command_1', now,
    })).rejects.toMatchObject({ code: 'PUBLICATION_RECIPE_MISMATCH', status: 409 });
  });

  it('moves a claimed command to review only by compare-and-swap', async () => {
    const repo = repository();
    await expect(reportEditorReady({
      repository: repo, deviceId: 'device_1', commandId: 'command_1', revision: 3, now,
    })).resolves.toEqual({ state: 'awaiting_review' });
    expect(repo.compareAndSwap).toHaveBeenCalledWith(expect.objectContaining({
      commandId: 'command_1', deviceId: 'device_1', revision: 3,
      from: 'claimed', to: 'awaiting_review',
    }));
  });

  it('begins publication only after the exact command was approved', async () => {
    const repo = repository();
    await expect(beginDevicePublish({
      repository: repo, deviceId: 'device_1', commandId: 'command_1', revision: 3, now,
    })).resolves.toEqual({ state: 'publishing' });
    expect(repo.compareAndSwap).toHaveBeenCalledWith(expect.objectContaining({
      from: 'approved', to: 'publishing',
    }));
  });

  it.each([
    ['succeeded', { publishedUrl: 'https://www.binance.com/en/square/post/123' }],
    ['failed', { failureReason: 'Binance rejected the editor submission.' }],
    ['outcome_unknown', { failureReason: 'Could not verify the final Binance URL.' }],
  ] as const)('records terminal %s results without retrying', async (outcome, detail) => {
    const repo = repository();
    await expect(reportPublishResult({
      repository: repo,
      deviceId: 'device_1',
      commandId: 'command_1',
      revision: 3,
      outcome,
      ...detail,
      now,
    })).resolves.toEqual({ state: outcome });
    expect(repo.compareAndSwap).toHaveBeenCalledWith(expect.objectContaining({
      from: 'publishing', to: outcome,
    }));
  });

  it('rejects a non-Binance success URL before persistence', async () => {
    const repo = repository();
    await expect(reportPublishResult({
      repository: repo, deviceId: 'device_1', commandId: 'command_1', revision: 3,
      outcome: 'succeeded', publishedUrl: 'https://evil.example/post/123', now,
    })).rejects.toThrow(/Binance/i);
    expect(repo.compareAndSwap).not.toHaveBeenCalled();
  });

  it('returns metadata-only status to the exact assigned device and derives expiry safely', async () => {
    const repo = repository({
      loadStatus: vi.fn(async () => ({
        id: 'command_1', draftId: 'draft_1', deviceId: 'device_1', state: 'approved' as const,
        revision: 3, recipeHash: 'a'.repeat(64), expiresAt: new Date('2026-07-19T00:15:00Z'),
      })),
    });
    await expect(getPublisherCommandStatus({
      repository: repo, deviceId: 'device_1', commandId: 'command_1', now,
    })).resolves.toEqual({
      id: 'command_1', target: 'binance-square', state: 'approved', revision: 3,
      recipeHash: 'a'.repeat(64), expiresAt: new Date('2026-07-19T00:15:00Z'),
    });

    const expiredRepository = repository({
        loadStatus: vi.fn(async () => ({
          id: 'command_1', draftId: 'draft_1', deviceId: 'device_1', state: 'awaiting_review' as const,
          revision: 3, recipeHash: 'a'.repeat(64), expiresAt: now,
        })),
      });
    await expect(getPublisherCommandStatus({
      repository: expiredRepository,
      deviceId: 'device_1', commandId: 'command_1', now,
    })).resolves.toMatchObject({ state: 'expired' });
    expect(expiredRepository.compareAndSwap).toHaveBeenCalledWith({
      commandId: 'command_1', deviceId: 'device_1', revision: 3,
      from: 'awaiting_review', to: 'expired', now,
    });
  });

  it('aborts only pre-click states with a fixed safe reason code', async () => {
    const repo = repository();
    await expect(abortPublisherCommand({
      repository: repo,
      deviceId: 'device_1',
      commandId: 'command_1',
      revision: 3,
      reasonCode: 'EDITOR_COMPOSITION_FAILED',
      now,
    })).resolves.toEqual({ state: 'cancelled' });
    expect(repo.abort).toHaveBeenCalledWith({
      deviceId: 'device_1', commandId: 'command_1', revision: 3,
      reasonCode: 'EDITOR_COMPOSITION_FAILED', now,
    });
    await expect(abortPublisherCommand({
      repository: repo,
      deviceId: 'device_1', commandId: 'command_1', revision: 3,
      reasonCode: '/Users/alice/private/chrome-profile',
      now,
    })).rejects.toThrow();
  });
});
