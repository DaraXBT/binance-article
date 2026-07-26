import { describe, expect, it, vi } from 'vitest';

import { createBinanceDraftRepository } from './draft-repository';

describe('Binance draft repository', () => {
  it('uses one tenant-checked upsert with revision compare-and-swap', async () => {
    const captured: Array<{ text: string; values: unknown[] }> = [];
    const transaction = vi.fn(async (
      build: (query: (strings: TemplateStringsArray, ...values: unknown[]) => unknown) => unknown[],
    ) => {
      build((strings, ...values) => {
        const query = { text: strings.join('?'), values };
        captured.push(query);
        return query;
      });
      return [[{ id: 'draft_1', revision: 3, status: 'draft' }]];
    });
    const repository = createBinanceDraftRepository({ $client: { transaction } } as never);

    await expect(repository.saveDraft({
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
      articleId: 'article_1',
      draftId: 'draft_1',
      expectedRevision: 2,
      title: 'Title',
      markdown: 'Body',
      cover: { assetId: 'asset_1', focalX: 0.5, focalY: 0.5, targetWidth: 1000, targetHeight: 400 },
      orderedAssetIds: ['asset_1'],
      expiresAt: new Date('2026-07-19T00:15:00.000Z'),
      now: new Date('2026-07-19T00:00:00.000Z'),
    })).resolves.toMatchObject({ id: 'draft_1', revision: 3 });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.text).toMatch(/INSERT INTO "PublicationDraft"/);
    expect(captured[0]?.text).toMatch(/ON CONFLICT \("workspaceId", "articleId", "target"\) DO UPDATE/);
    expect(captured[0]?.text).toMatch(/"WorkspaceMember"/);
    expect(captured[0]?.text).toMatch(/"DeckProject"/);
    // Expired queued drafts (dead companion device) may be saved over.
    expect(captured[0]?.text).toMatch(
      /"status" = 'queued'::"PublicationDraftStatus"[\s\S]*"expiresAt" <=/,
    );
    expect(captured[0]?.text).not.toContain('user_1');
    expect(captured[0]?.values).toContain('user_1');
  });

  it('returns null when the revision or tenant compare-and-swap fails', async () => {
    const transaction = vi.fn(async (
      build: (query: (strings: TemplateStringsArray, ...values: unknown[]) => unknown) => unknown[],
    ) => {
      build((strings, ...values) => ({ text: strings.join('?'), values }));
      return [[]];
    });
    const repository = createBinanceDraftRepository({ $client: { transaction } } as never);

    await expect(repository.saveDraft({
      actorUserId: 'user_1', workspaceId: 'workspace_1', articleId: 'article_1', draftId: 'draft_1',
      expectedRevision: 2, title: 'Title', markdown: 'Body',
      cover: { assetId: 'asset_1', focalX: 0.5, focalY: 0.5, targetWidth: 1000, targetHeight: 400 },
      orderedAssetIds: ['asset_1'], expiresAt: new Date(), now: new Date(),
    })).resolves.toBeNull();
  });
});
