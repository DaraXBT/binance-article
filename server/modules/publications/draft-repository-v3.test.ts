import { describe, expect, it, vi } from 'vitest';

import { createPublicationDraftRepository } from './draft-repository';

describe('kind-aware publication draft repository', () => {
  it('persists and conflicts on the independent target and kind dimensions', async () => {
    const captured: Array<{ text: string; values: unknown[] }> = [];
    const transaction = vi.fn(async (
      build: (query: (strings: TemplateStringsArray, ...values: unknown[]) => unknown) => unknown[],
    ) => {
      build((strings, ...values) => {
        captured.push({ text: strings.join('?'), values });
        return { text: strings.join('?'), values };
      });
      return [[{
        id: 'draft_1', workspaceId: 'workspace_1', articleId: 'article_1',
        target: 'x', kind: 'article', revision: 1, status: 'draft', payload: {},
        expiresAt: new Date(), publishedUrl: null, updatedAt: new Date(),
      }]];
    });
    const repository = createPublicationDraftRepository({ $client: { transaction } } as never);

    await expect(repository.saveDraft({
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
      articleId: 'article_1',
      target: 'x',
      kind: 'article',
      draftId: 'draft_1',
      expectedRevision: 0,
      payload: { title: 'Title', markdown: 'Body', orderedAssetIds: [] },
      expiresAt: new Date('2026-08-16T00:15:00.000Z'),
      now: new Date('2026-08-16T00:00:00.000Z'),
    })).resolves.toMatchObject({ target: 'x', kind: 'article' });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.text).toMatch(/"target", "kind", "version"/);
    expect(captured[0]?.text).toMatch(/\?::"PublicationTarget", \?::"PublicationKind"/);
    expect(captured[0]?.text).toMatch(
      /ON CONFLICT \("workspaceId", "articleId", "target", "kind"\) DO UPDATE/,
    );
    expect(captured[0]?.text).toMatch(/RETURNING[\s\S]*"target", "kind", "revision"/);
    expect(captured[0]?.values).toContain('article');
  });
});
