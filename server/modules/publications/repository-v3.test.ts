import { describe, expect, it, vi } from 'vitest';

import { createPublicationRepository } from './repository';

type KindAwareCommit = (input: Record<string, unknown>) => Promise<boolean>;

describe('kind-aware publication repository', () => {
  it.each([
    ['post', {
      version: 3, target: 'binance-square', kind: 'post', draftId: 'draft_post',
      articleId: 'article_1', revision: 2, expiresAt: '2026-08-16T00:15:00.000Z',
      text: 'A post', orderedAssetIds: [], assets: [],
    }, { text: 'A post', orderedAssetIds: [] }],
    ['article', {
      version: 3, target: 'x', kind: 'article', draftId: 'draft_article',
      articleId: 'article_1', revision: 2, expiresAt: '2026-08-16T00:15:00.000Z',
      title: 'Title', markdown: 'Body', orderedAssetIds: [], assets: [],
    }, { title: 'Title', markdown: 'Body', orderedAssetIds: [] }],
  ] as const)('binds %s into command identity and payload serialization', async (
    kind,
    recipe,
    expectedPayload,
  ) => {
    const captured: Array<{ text: string; values: unknown[] }> = [];
    const transaction = vi.fn(async (
      build: (query: (strings: TemplateStringsArray, ...values: unknown[]) => unknown) => unknown[],
    ) => {
      build((strings, ...values) => {
        captured.push({ text: strings.join('?'), values });
        return { text: strings.join('?'), values };
      });
      return [[{ id: 'command_1' }]];
    });
    const repository = createPublicationRepository({ $client: { transaction } } as never);
    const commit = repository.commitPreparedPublication as unknown as KindAwareCommit;

    await expect(commit({
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
      target: recipe.target,
      kind,
      expectedRevision: 2,
      recipeHash: 'a'.repeat(64),
      recipe,
      command: {
        id: 'command_1', draftId: recipe.draftId, deviceId: 'device_1',
        target: recipe.target, kind, state: 'queued', revision: 2,
        recipeHash: 'a'.repeat(64), expiresAt: new Date(recipe.expiresAt),
      },
    })).resolves.toBe(true);

    expect(captured[0]?.text).toMatch(/draft\."kind" = \?::"PublicationKind"/);
    expect(captured[0]?.text).toMatch(/"target", "kind", "deviceId"/);
    expect(captured[0]?.text).toMatch(/protocolVersion/);
    expect(captured[0]?.values).toContain(kind);
    expect(captured[0]?.values).toContain(
      `prepare:${recipe.target}:${kind}:${recipe.draftId}:2`,
    );
    expect(captured[0]?.values).toContain(JSON.stringify(expectedPayload));
  });
});
