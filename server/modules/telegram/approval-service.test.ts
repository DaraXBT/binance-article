import { describe, expect, it, vi } from 'vitest';

import {
  confirmTelegramPublish,
  requestTelegramPublishConfirmation,
} from './approval-service';

const now = new Date('2026-07-19T00:00:00.000Z');

describe('Telegram publish approval service', () => {
  it('returns a one-time callback token while persisting only its SHA-256 hash', async () => {
    const repository = {
      requestConfirmation: vi.fn(async (_input: unknown) => ({
        commandId: '11111111-1111-4111-8111-111111111111',
        expiresAt: new Date('2026-07-19T00:02:00.000Z'),
      })),
      confirm: vi.fn(),
      expire: vi.fn(),
    };

    const result = await requestTelegramPublishConfirmation({
      repository,
      actorUserId: 'user_1',
      telegramUserId: '777',
      commandId: '11111111-1111-4111-8111-111111111111',
      approvalId: 'approval_1',
      entropy: new Uint8Array(32).fill(7),
      now,
    });

    expect(result.callbackToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.expiresAt).toEqual(new Date('2026-07-19T00:02:00.000Z'));
    expect(repository.requestConfirmation).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'user_1',
      telegramUserId: '777',
      commandId: '11111111-1111-4111-8111-111111111111',
      callbackTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      requestedExpiresAt: new Date('2026-07-19T00:02:00.000Z'),
    }));
    expect(JSON.stringify(repository.requestConfirmation.mock.calls[0][0]))
      .not.toContain(result.callbackToken);
  });

  it('confirms with the same linked actor and hashes the opaque callback token', async () => {
    const repository = {
      requestConfirmation: vi.fn(),
      confirm: vi.fn(async (_input: unknown) => ({ commandId: 'command_1' })),
      expire: vi.fn(),
    };
    const callbackToken = 'A'.repeat(43);

    await expect(confirmTelegramPublish({
      repository,
      actorUserId: 'user_1',
      telegramUserId: '777',
      callbackToken,
      now,
    })).resolves.toEqual({ commandId: 'command_1' });
    expect(repository.confirm).toHaveBeenCalledWith({
      actorUserId: 'user_1',
      telegramUserId: '777',
      callbackTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      now,
    });
    expect(JSON.stringify(repository.confirm.mock.calls[0][0])).not.toContain(callbackToken);
  });

  it('atomically expires an elapsed challenge and never approves it', async () => {
    const repository = {
      requestConfirmation: vi.fn(),
      confirm: vi.fn(async (_input: unknown) => null),
      expire: vi.fn(async (_input: unknown) => true),
    };

    await expect(confirmTelegramPublish({
      repository,
      actorUserId: 'user_1',
      telegramUserId: '777',
      callbackToken: 'A'.repeat(43),
      now,
    })).rejects.toMatchObject({ code: 'PUBLISH_APPROVAL_EXPIRED', status: 409 });
    expect(repository.expire).toHaveBeenCalledOnce();
  });
});
