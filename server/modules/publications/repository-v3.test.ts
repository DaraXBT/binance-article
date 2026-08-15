import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { createPublicationRepository } from './repository';

type KindAwareCommit = (input: Record<string, unknown>) => Promise<boolean>;

function queryReturning(rows: unknown[]) {
  const query = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(async () => rows),
  };
  query.from.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  return query;
}

function sqlText(value: unknown): string {
  return new PgDialect().sqlToQuery(value as SQL).sql;
}

describe('kind-aware publication repository', () => {
  it('prefers a compatible device without filtering out an older-protocol fallback', async () => {
    const draftQuery = queryReturning([{
      id: 'draft_x_article',
      workspaceId: 'workspace_1',
      articleId: 'article_1',
      target: 'x',
      kind: 'article',
      revision: 2,
      payload: { title: 'Title', markdown: 'Body', orderedAssetIds: [] },
      expiresAt: new Date('2026-08-16T00:15:00.000Z'),
      articleGenerationRevision: 1,
    }]);
    const quotaQuery = queryReturning([{
      articlesPerMonth: 3,
      imagesPerMonth: 24,
      maxSlidesPerArticle: 10,
      publishingEnabled: true,
    }]);
    const deviceQuery = queryReturning([{
      id: 'device_v1',
      status: 'active',
      lastSeenAt: new Date('2026-08-16T00:00:00.000Z'),
      protocolVersion: 1,
    }]);
    const select = vi.fn()
      .mockReturnValueOnce(draftQuery)
      .mockReturnValueOnce(quotaQuery)
      .mockReturnValueOnce(deviceQuery);
    const repository = createPublicationRepository({ select } as never);

    const loaded = await repository.loadPreparationContext({
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
      articleId: 'article_1',
      target: 'x',
      kind: 'article',
      preferredProtocolVersion: 2,
    } as never);

    expect(loaded?.device).toMatchObject({ id: 'device_v1', protocolVersion: 1 });
    const whereSql = sqlText(deviceQuery.where.mock.calls[0]?.[0]);
    expect(whereSql).toMatch(/"PublisherDevice"\."status" =/);
    expect(whereSql).not.toMatch(/"PublisherDevice"\."protocolVersion"/);
    const order = deviceQuery.orderBy.mock.calls[0] ?? [];
    expect(order).toHaveLength(2);
    expect(sqlText(order[0])).toMatch(/"PublisherDevice"\."protocolVersion" >= \$1 desc/);
    expect(sqlText(order[1])).toMatch(/"PublisherDevice"\."lastSeenAt" desc/);
  });

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
