import { describe, expect, it, vi } from 'vitest';

import { approveWebPublication, cancelWebPublication, getWebPublisherCommand } from './service';

const now = new Date('2026-07-22T00:00:00.000Z');
const command = {
  id: 'command_1',
  draftId: 'draft_1',
  target: 'x' as const,
  kind: 'article' as const,
  state: 'approved',
  revision: 2,
  recipeHash: 'a'.repeat(64),
  expiresAt: new Date('2026-07-22T00:15:00.000Z'),
};

describe('web publication approval', () => {
  it('requires an explicit hash-bound confirmation', async () => {
    const repository = {
      loadCommand: vi.fn(), approve: vi.fn(), cancel: vi.fn(), expire: vi.fn(),
    };
    await expect(approveWebPublication({
      repository,
      actorUserId: 'user_1', commandId: 'command_1', revision: 2,
      recipeHash: 'a'.repeat(64), confirmed: false, now,
    })).rejects.toMatchObject({ code: 'PUBLISH_CONFIRMATION_REQUIRED', status: 400 });
    expect(repository.approve).not.toHaveBeenCalled();
  });

  it('records exactly one authenticated web approval', async () => {
    const repository = {
      loadCommand: vi.fn(), approve: vi.fn(async () => command), cancel: vi.fn(), expire: vi.fn(),
    };
    await expect(approveWebPublication({
      repository,
      actorUserId: 'user_1', commandId: 'command_1', revision: 2,
      recipeHash: 'a'.repeat(64), confirmed: true, approvalId: 'approval_1', now,
    })).resolves.toMatchObject({
      id: 'command_1', target: 'x', kind: 'article', state: 'approved',
    });
    expect(repository.approve).toHaveBeenCalledWith({
      approvalId: 'approval_1', actorUserId: 'user_1', commandId: 'command_1',
      revision: 2, recipeHash: 'a'.repeat(64), now,
    });
  });

  it('derives expiry for web command timelines', async () => {
    const repository = {
      loadCommand: vi.fn(async () => ({ ...command, state: 'awaiting_review', expiresAt: now })),
      approve: vi.fn(),
      cancel: vi.fn(),
      expire: vi.fn(async () => ({ ...command, state: 'expired', expiresAt: now })),
    };
    await expect(getWebPublisherCommand({
      repository, actorUserId: 'user_1', commandId: 'command_1', now,
    })).resolves.toMatchObject({ state: 'expired', target: 'x', kind: 'article' });
    expect(repository.expire).toHaveBeenCalledWith({
      actorUserId: 'user_1', commandId: 'command_1', now,
    });
  });

  it('cancels only an explicitly confirmed revision and recipe hash', async () => {
    const repository = {
      loadCommand: vi.fn(), approve: vi.fn(), expire: vi.fn(),
      cancel: vi.fn(async () => ({ ...command, state: 'cancelled' })),
    };
    await expect(cancelWebPublication({
      repository, actorUserId: 'user_1', commandId: 'command_1', revision: 2,
      recipeHash: 'a'.repeat(64), confirmed: true, now,
    })).resolves.toMatchObject({ state: 'cancelled' });
    expect(repository.cancel).toHaveBeenCalledWith({
      actorUserId: 'user_1', commandId: 'command_1', revision: 2,
      recipeHash: 'a'.repeat(64), now,
    });
  });

  it('rejects an unconfirmed cancellation before touching persistence', async () => {
    const repository = {
      loadCommand: vi.fn(), approve: vi.fn(), expire: vi.fn(), cancel: vi.fn(),
    };
    await expect(cancelWebPublication({
      repository, actorUserId: 'user_1', commandId: 'command_1', revision: 2,
      recipeHash: 'a'.repeat(64), confirmed: false, now,
    })).rejects.toMatchObject({
      code: 'PUBLISH_CANCELLATION_CONFIRMATION_REQUIRED', status: 400,
    });
    expect(repository.cancel).not.toHaveBeenCalled();
  });
});
