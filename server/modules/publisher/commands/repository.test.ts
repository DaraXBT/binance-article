import { describe, expect, it, vi } from 'vitest';

import { createPublisherCommandRepository } from './repository';

function clientReturning(rows: unknown[]) {
  const captured: Array<{ text: string; values: unknown[] }> = [];
  const client = Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      captured.push({ text: strings.join('?'), values });
      return Promise.resolve(rows);
    }),
    { transaction: vi.fn() },
  );
  return { client, captured };
}

describe('publisher command repository', () => {
  it('claims one queued command with a locked skip-locked selection', async () => {
    const { client, captured } = clientReturning([{
      id: 'command_1', draftId: 'draft_1', deviceId: 'device_1', state: 'claimed',
      revision: 3, recipeHash: 'a'.repeat(64), expiresAt: new Date(),
    }]);
    const repository = createPublisherCommandRepository({ $client: client } as never);

    await expect(repository.claimNext({ deviceId: 'device_1', now: new Date() }))
      .resolves.toMatchObject({ id: 'command_1', state: 'claimed' });
    expect(captured[0]?.text).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(captured[0]?.text).toMatch(/UPDATE "PublisherCommand"/);
    expect(captured[0]?.text).not.toContain('device_1');
    expect(captured[0]?.values).toContain('device_1');
  });

  it('updates command and publication draft state in one compare-and-swap statement', async () => {
    const { client, captured } = clientReturning([{ id: 'command_1' }]);
    const repository = createPublisherCommandRepository({ $client: client } as never);

    await expect(repository.compareAndSwap({
      commandId: 'command_1', deviceId: 'device_1', revision: 3,
      from: 'publishing', to: 'succeeded', now: new Date(),
      publishedUrl: 'https://www.binance.com/en/square/post/123',
    })).resolves.toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.text).toMatch(/WITH updated_command AS/);
    expect(captured[0]?.text).toMatch(/UPDATE "PublisherCommand"/);
    expect(captured[0]?.text).toMatch(/UPDATE "BinancePublicationDraft"/);
  });

  it('loads status by exact assigned device without recipe or credential data', async () => {
    const { client, captured } = clientReturning([{
      id: 'command_1', draftId: 'draft_1', deviceId: 'device_1', state: 'approved',
      revision: 3, recipeHash: 'a'.repeat(64), expiresAt: new Date(),
    }]);
    const repository = createPublisherCommandRepository({ $client: client } as never);
    await repository.loadStatus({ deviceId: 'device_1', commandId: 'command_1' });
    expect(captured[0].text).toMatch(/"deviceId" = \?/);
    expect(captured[0].text).not.toMatch(/markdown|r2Key|tokenHash|failureReason/i);
  });

  it('atomically aborts command, draft, and any open approval before publishing', async () => {
    const { client, captured } = clientReturning([{ id: 'command_1' }]);
    const repository = createPublisherCommandRepository({ $client: client } as never);
    await expect(repository.abort({
      deviceId: 'device_1', commandId: 'command_1', revision: 3,
      reasonCode: 'EDITOR_COMPOSITION_FAILED', now: new Date(),
    })).resolves.toBe(true);
    expect(captured[0].text).toMatch(/UPDATE "PublisherCommand"/);
    expect(captured[0].text).toMatch(/UPDATE "BinancePublicationDraft"/);
    expect(captured[0].text).toMatch(/UPDATE "PublishApproval"/);
    expect(captured[0].text).toMatch(/'publishing'/);
  });
});
