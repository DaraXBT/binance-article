import { describe, expect, it, vi } from 'vitest';

import { PUBLICATION_DRAFT_LIFETIME_MS } from '@/server/domain/publication-recipe';

import { getBinanceDraft, saveBinanceDraft } from './draft-service';

const now = new Date('2026-07-19T00:00:00.000Z');

function validInput() {
  return {
    expectedRevision: 2,
    title: 'Reviewed article',
    markdown: '## Thesis\n\n![Chart](asset:asset_1)',
    cover: { assetId: 'asset_1', focalX: 0.5, focalY: 0.4 },
    orderedAssetIds: ['asset_1'],
  };
}

describe('Binance publication drafts', () => {
  it('atomically saves a 15-minute draft with fixed local crop dimensions', async () => {
    const repository = {
      getDraft: vi.fn(),
      saveDraft: vi.fn(async (input) => ({ ...input, revision: 3 })),
    };
    const result = await saveBinanceDraft({
      repository,
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
      articleId: 'article_1',
      draftId: 'draft_1',
      input: validInput(),
      now,
    });

    expect(repository.saveDraft).toHaveBeenCalledWith({
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
      articleId: 'article_1',
      draftId: 'draft_1',
      expectedRevision: 2,
      title: 'Reviewed article',
      markdown: validInput().markdown,
      cover: {
        assetId: 'asset_1', focalX: 0.5, focalY: 0.4, targetWidth: 1000, targetHeight: 400,
      },
      orderedAssetIds: ['asset_1'],
      expiresAt: new Date(now.getTime() + PUBLICATION_DRAFT_LIFETIME_MS),
      now,
    });
    expect(result.revision).toBe(3);
  });

  it('uses expected revision zero only for the first draft', async () => {
    const repository = {
      getDraft: vi.fn(),
      saveDraft: vi.fn(async (input) => ({ ...input, revision: 1 })),
    };
    await saveBinanceDraft({
      repository, actorUserId: 'user_1', workspaceId: 'workspace_1', articleId: 'article_1',
      draftId: 'draft_1', input: { ...validInput(), expectedRevision: 0 }, now,
    });
    expect(repository.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 0 }));
  });

  it('does not require a client-selected cover asset because preparation binds the dedicated cover', async () => {
    const repository = {
      getDraft: vi.fn(),
      saveDraft: vi.fn(async (input) => ({ ...input, revision: 1 })),
    };
    const input = validInput();
    const { assetId: _ignored, ...focal } = input.cover;
    await expect(saveBinanceDraft({
      repository,
      actorUserId: 'user_1', workspaceId: 'workspace_1', articleId: 'article_1',
      draftId: 'draft_1', input: { ...input, expectedRevision: 0, cover: focal }, now,
    })).resolves.toMatchObject({ revision: 1 });
    expect(repository.saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      cover: { ...focal, targetWidth: 1000, targetHeight: 400 },
    }));
  });

  it('rejects invalid asset order, limits, and stale compare-and-swap results', async () => {
    const base = {
      actorUserId: 'user_1', workspaceId: 'workspace_1', articleId: 'article_1',
      draftId: 'draft_1', now,
    };
    const repository = { getDraft: vi.fn(), saveDraft: vi.fn(async () => null) };

    await expect(saveBinanceDraft({
      ...base, repository, input: { ...validInput(), orderedAssetIds: ['asset_1', 'asset_1'] },
    })).rejects.toMatchObject({ code: 'INVALID_PUBLICATION_DRAFT', status: 400 });
    await expect(saveBinanceDraft({
      ...base,
      repository,
      input: { ...validInput(), orderedAssetIds: Array.from({ length: 11 }, (_, index) => `asset_${index}`) },
    })).rejects.toMatchObject({ code: 'INVALID_PUBLICATION_DRAFT', status: 400 });
    await expect(saveBinanceDraft({ ...base, repository, input: validInput() }))
      .rejects.toMatchObject({ code: 'PUBLICATION_REVISION_STALE', status: 409 });
  });

  it('loads a draft only through the actor/workspace repository boundary', async () => {
    const draft = { id: 'draft_1', revision: 2 };
    const repository = {
      getDraft: vi.fn(async () => draft),
      saveDraft: vi.fn(),
    };
    await expect(getBinanceDraft({
      repository, actorUserId: 'user_1', workspaceId: 'workspace_1', articleId: 'article_1',
    })).resolves.toBe(draft);
    expect(repository.getDraft).toHaveBeenCalledWith({
      actorUserId: 'user_1', workspaceId: 'workspace_1', articleId: 'article_1',
    });
  });
});
