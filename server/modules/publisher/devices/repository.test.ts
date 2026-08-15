import { describe, expect, it, vi } from 'vitest';

import { createPublisherDeviceRepository } from './repository';

describe('publisher device repository liveness', () => {
  it('requires an active owner and current membership for creation, activation, and authentication', async () => {
    const captured: Array<{ text: string; values: unknown[] }> = [];
    const rows = [
      [{ id: 'device_1' }],
      [{
        id: 'device_1', userId: 'user_1', workspaceId: 'workspace_1', name: 'Mac',
        status: 'active', protocolVersion: 1,
      }],
      [{
        id: 'device_1', userId: 'user_1', workspaceId: 'workspace_1', name: 'Mac',
        status: 'active', protocolVersion: 1,
      }],
    ];
    const client = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      captured.push({ text: strings.join('?'), values });
      return rows[captured.length - 1];
    });
    const repository = createPublisherDeviceRepository({ $client: client } as never);
    const now = new Date('2026-07-19T00:00:00.000Z');

    await expect(repository.createPending({
      id: 'device_1', userId: 'user_1', workspaceId: 'workspace_1', name: 'Mac',
      tokenHash: 'a'.repeat(64), tokenPrefix: 'aaaaaaaa', now,
    })).resolves.toEqual({ id: 'device_1' });
    await expect(repository.activatePending({
      pairingHash: 'a'.repeat(64), deviceTokenHash: 'b'.repeat(64),
      deviceTokenPrefix: 'bbbbbbbb', protocolVersion: 2,
      notBefore: new Date(now.getTime() - 600_000), now,
    })).resolves.toMatchObject({ id: 'device_1', status: 'active' });
    await expect(repository.authenticate({ tokenHash: 'b'.repeat(64), now }))
      .resolves.toMatchObject({ id: 'device_1', status: 'active' });

    expect(client).toHaveBeenCalledTimes(3);
    for (const query of captured) {
      expect(query.text).toMatch(/"user"[\s\S]*"status" = 'active'/);
      expect(query.text).toMatch(/"WorkspaceMember"/);
      expect(query.text).toMatch(/member\."userId"[\s\S]*member\."workspaceId"/);
    }
    expect(captured[1]?.text).toMatch(/UPDATE "PublisherDevice"/);
    expect(captured[1]?.text).toMatch(/"protocolVersion" =/);
    expect(captured[1]?.values).toContain(2);
    expect(captured[2]?.text).toMatch(/UPDATE "PublisherDevice"/);
  });

  it('returns null without touching a stale device when its principal is no longer live', async () => {
    const client = vi.fn(async () => []);
    const repository = createPublisherDeviceRepository({ $client: client } as never);
    await expect(repository.authenticate({
      tokenHash: 'c'.repeat(64), now: new Date('2026-07-19T00:00:00.000Z'),
    })).resolves.toBeNull();
  });

  it('lists and revokes devices only inside the active actor workspace membership', async () => {
    const captured: Array<{ text: string; values: unknown[] }> = [];
    const lastSeenAt = new Date('2026-07-22T03:00:00.000Z');
    const client = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      captured.push({ text: strings.join('?'), values });
      return captured.length === 1
        ? [{
            id: 'device_1', name: 'Studio Mac', status: 'active',
            protocolVersion: 1, lastSeenAt,
          }]
        : [{ id: 'device_1' }];
    });
    const repository = createPublisherDeviceRepository({ $client: client } as never);
    const now = new Date('2026-07-22T03:05:00.000Z');

    await expect(repository.listForUserWorkspace({
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
    })).resolves.toEqual([{
      id: 'device_1', name: 'Studio Mac', status: 'active',
      protocolVersion: 1, lastSeenAt,
    }]);
    await expect(repository.revokeForUserWorkspace({
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
      deviceId: 'device_1',
      now,
    })).resolves.toBe(true);

    expect(client).toHaveBeenCalledTimes(2);
    for (const query of captured) {
      expect(query.text).toMatch(/device\."userId" =/);
      expect(query.text).toMatch(/device\."workspaceId" =/);
      expect(query.text).toMatch(/"WorkspaceMember"/);
      expect(query.values).toEqual(expect.arrayContaining(['user_1', 'workspace_1']));
    }
    expect(captured[0]?.text).toMatch(/SELECT[\s\S]*device\."lastSeenAt"/);
    expect(captured[1]?.text).toMatch(/UPDATE "PublisherDevice"/);
    expect(captured[1]?.text).toMatch(/device\."status" IN \('pending', 'active'\)/);
    expect(captured[1]?.text).toMatch(/"revokedAt" =/);
  });
});
