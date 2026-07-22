import { describe, expect, it, vi } from 'vitest';

import { createBinancePublicationRepository } from './repository';

describe('Binance publication repository', () => {
  it('commits the exact draft revision and command in one parameterized statement', async () => {
    const captured: Array<{ text: string; values: unknown[] }> = [];
    const transaction = vi.fn(async (
      build: (query: (strings: TemplateStringsArray, ...values: unknown[]) => unknown) => unknown[],
      options: unknown,
    ) => {
      const query = (strings: TemplateStringsArray, ...values: unknown[]) => {
        const built = { text: strings.join('?'), values };
        captured.push(built);
        return built;
      };
      build(query);
      expect(options).toEqual({ isolationLevel: 'ReadCommitted' });
      return [[{ id: 'command_1' }]];
    });
    const database = { $client: { transaction } } as never;
    const repository = createBinancePublicationRepository(database);

    await expect(repository.commitPreparedPublication({
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
      expectedRevision: 3,
      target: 'binance-square',
      recipeHash: 'a'.repeat(64),
      recipe: {
        version: 2,
        target: 'binance-square',
        draftId: 'draft_1',
        articleId: 'article_1',
        revision: 3,
        expiresAt: '2026-07-19T00:15:00.000Z',
        title: 'Title',
        markdown: 'Body',
        cover: { assetId: 'asset_1', focalX: 0.5, focalY: 0.5, targetWidth: 1000, targetHeight: 400 },
        orderedAssetIds: [],
        assets: [{ id: 'asset_1', mimeType: 'image/png', sizeBytes: 100, sha256: 'a'.repeat(64) }],
      },
      command: {
        id: 'command_1',
        draftId: 'draft_1',
        deviceId: 'device_1',
        target: 'binance-square',
        state: 'queued',
        revision: 3,
        recipeHash: 'a'.repeat(64),
        expiresAt: new Date('2026-07-19T00:15:00.000Z'),
      },
    })).resolves.toBe(true);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.text).toMatch(/WITH updated_draft AS[\s\S]*UPDATE "PublicationDraft"/);
    expect(captured[0]?.text).toMatch(/INSERT INTO "PublisherCommand"/);
    expect(captured[0]?.text).toMatch(/"WorkspaceMember"/);
    expect(captured[0]?.text).not.toContain('user_1');
    expect(captured[0]?.values).toContain('user_1');
  });

  it('reports a stale compare-and-swap when nothing is inserted', async () => {
    const transaction = vi.fn(async (
      build: (query: (strings: TemplateStringsArray, ...values: unknown[]) => unknown) => unknown[],
    ) => {
      build((strings, ...values) => ({ text: strings.join('?'), values }));
      return [[]];
    });
    const repository = createBinancePublicationRepository({ $client: { transaction } } as never);

    await expect(repository.commitPreparedPublication({
      actorUserId: 'user_1', workspaceId: 'workspace_1', expectedRevision: 2,
      target: 'binance-square',
      recipeHash: 'b'.repeat(64),
      recipe: {
        version: 2, target: 'x', draftId: 'draft_1', articleId: 'article_1', revision: 2,
        expiresAt: '2026-07-19T00:15:00.000Z', text: 'Post', orderedAssetIds: [], assets: [],
      },
      command: {
        id: 'command_1', draftId: 'draft_1', deviceId: 'device_1', state: 'queued',
        target: 'binance-square',
        revision: 2, recipeHash: 'b'.repeat(64), expiresAt: new Date('2026-07-19T00:15:00.000Z'),
      },
    })).resolves.toBe(false);
  });
});
