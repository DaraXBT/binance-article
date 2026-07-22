import { describe, expect, it, vi } from 'vitest';

import { savePublicationDraft } from './draft-service';

const now = new Date('2026-07-22T00:00:00.000Z');

describe('target-aware publication drafts', () => {
  it('saves a regular X draft with revision compare-and-swap', async () => {
    const repository = {
      getDraft: vi.fn(),
      saveDraft: vi.fn(async (input) => ({
        id: input.draftId,
        workspaceId: input.workspaceId,
        articleId: input.articleId,
        target: input.target,
        revision: 1,
        status: 'draft',
        payload: input.payload,
        expiresAt: input.expiresAt,
        publishedUrl: null,
        updatedAt: input.now,
      })),
    };
    await expect(savePublicationDraft({
      repository,
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
      articleId: 'article_1',
      target: 'x',
      draftId: 'draft_x',
      input: { expectedRevision: 0, text: 'A regular post', orderedAssetIds: ['asset_1'] },
      now,
    })).resolves.toMatchObject({
      target: 'x',
      revision: 1,
      text: 'A regular post',
      orderedAssetIds: ['asset_1'],
    });
    expect(repository.saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      target: 'x',
      expectedRevision: 0,
      payload: { text: 'A regular post', orderedAssetIds: ['asset_1'] },
    }));
  });

  it('rejects long posts, duplicate images, and empty publications', async () => {
    const repository = { getDraft: vi.fn(), saveDraft: vi.fn() };
    for (const input of [
      { expectedRevision: 0, text: 'x'.repeat(281), orderedAssetIds: [] },
      { expectedRevision: 0, text: 'post', orderedAssetIds: ['asset_1', 'asset_1'] },
      { expectedRevision: 0, text: '', orderedAssetIds: [] },
    ]) {
      await expect(savePublicationDraft({
        repository,
        actorUserId: 'user_1', workspaceId: 'workspace_1', articleId: 'article_1',
        target: 'x', input, now,
      })).rejects.toMatchObject({ code: 'INVALID_PUBLICATION_DRAFT', status: 400 });
    }
    expect(repository.saveDraft).not.toHaveBeenCalled();
  });
});
