import { describe, expect, it, vi } from 'vitest';

import { createAccountWorkspace } from './account-service';

const now = new Date('2026-07-19T00:00:00.000Z');
const entropy = Uint8Array.from({ length: 32 }, (_, index) => index);

describe('account-owned workspace service', () => {
  it('creates internal legacy placeholders without issuing a recovery secret', async () => {
    const repository = {
      createOrFind: vi.fn(async () => ({ id: 'workspace_1', created: true as const })),
    };
    await expect(createAccountWorkspace({
      repository,
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
      auditEventId: 'audit_1',
      entropy,
      now,
    })).resolves.toEqual({ id: 'workspace_1', created: true });

    expect(repository.createOrFind).toHaveBeenCalledWith({
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
      auditEventId: 'audit_1',
      accessKeyHash: '630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd',
      accessKeyPrefix: 'acct_630dcd29',
      now,
    });
    const persisted = JSON.stringify(repository.createOrFind.mock.calls);
    expect(persisted).not.toContain(Buffer.from(entropy).toString('hex'));
    expect(persisted).not.toMatch(/recoveryKey|accessKey\"/);
  });

  it('returns the existing account workspace after a concurrent create retry', async () => {
    const repository = {
      createOrFind: vi.fn(async () => ({ id: 'workspace_existing', created: false as const })),
    };
    await expect(createAccountWorkspace({
      repository,
      actorUserId: 'user_1',
      entropy,
      now,
    })).resolves.toEqual({ id: 'workspace_existing', created: false });
  });
});
