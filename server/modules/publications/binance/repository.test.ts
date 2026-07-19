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
      recipeHash: 'a'.repeat(64),
      command: {
        id: 'command_1',
        draftId: 'draft_1',
        deviceId: 'device_1',
        state: 'queued',
        revision: 3,
        recipeHash: 'a'.repeat(64),
        expiresAt: new Date('2026-07-19T00:15:00.000Z'),
      },
    })).resolves.toBe(true);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.text).toMatch(/WITH updated_draft AS[\s\S]*UPDATE "BinancePublicationDraft"/);
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
      recipeHash: 'b'.repeat(64),
      command: {
        id: 'command_1', draftId: 'draft_1', deviceId: 'device_1', state: 'queued',
        revision: 2, recipeHash: 'b'.repeat(64), expiresAt: new Date('2026-07-19T00:15:00.000Z'),
      },
    })).resolves.toBe(false);
  });
});
