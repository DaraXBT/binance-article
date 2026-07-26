import { describe, expect, it, vi } from 'vitest';

import { INVITATION_LIFETIME_MS, hashInvitationToken } from '@/server/domain/invitations';

import {
  MAX_ACTIVE_BETA_USERS,
  createInvitation,
  inspectInvitation,
  listInvitations,
  revokeInvitation,
} from './service';

const now = new Date('2026-07-19T00:00:00.000Z');
const entropy = Uint8Array.from({ length: 32 }, (_, index) => index);

function repository(overrides: Record<string, unknown> = {}) {
  return {
    insertWithinCapacity: vi.fn(async () => 'created' as const),
    findPendingByHash: vi.fn(async () => ({
      id: 'invite_1',
      email: 'invited@example.com',
      expiresAt: new Date(now.getTime() + INVITATION_LIFETIME_MS),
    })),
    list: vi.fn(async () => []),
    revoke: vi.fn(async () => true),
    ...overrides,
  };
}

describe('admin invitation service', () => {
  it('returns the raw token once while persisting only its hash and metadata', async () => {
    const repo = repository();
    const result = await createInvitation({
      repository: repo,
      actorUserId: 'owner_1',
      email: ' Invited@Example.com ',
      now,
      entropy,
      id: 'invite_1',
    });

    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.expiresAt).toEqual(new Date(now.getTime() + INVITATION_LIFETIME_MS));
    expect(repo.insertWithinCapacity).toHaveBeenCalledWith({
      id: 'invite_1',
      email: 'invited@example.com',
      tokenHash: await hashInvitationToken(result.token),
      tokenPrefix: result.token.slice(0, 8),
      createdByUserId: 'owner_1',
      expiresAt: result.expiresAt,
      now,
    }, MAX_ACTIVE_BETA_USERS);
    expect(JSON.stringify(repo.insertWithinCapacity.mock.calls)).not.toContain(result.token);
  });

  it('enforces the ten-user global beta cap before creating another invitation', async () => {
    const repo = repository({
      insertWithinCapacity: vi.fn(async () => 'cap_reached' as const),
    });

    await expect(createInvitation({
      repository: repo,
      actorUserId: 'owner_1',
      email: 'invited@example.com',
      now,
      entropy,
      id: 'invite_1',
    })).rejects.toMatchObject({ code: 'BETA_USER_CAP_REACHED', status: 409 });
    expect(repo.insertWithinCapacity).toHaveBeenCalledTimes(1);
  });

  it('normalizes and validates invitation email addresses', async () => {
    await expect(createInvitation({
      repository: repository(),
      actorUserId: 'owner_1',
      email: 'not-an-email',
      now,
      entropy,
      id: 'invite_1',
    })).rejects.toMatchObject({ code: 'INVALID_INVITATION_EMAIL', status: 400 });
  });

  it('inspects a join token by hash without consuming it or leaking the token', async () => {
    const repo = repository();
    await expect(inspectInvitation({ repository: repo, token: 'valid_token_value_1234567890', now }))
      .resolves.toEqual({ email: 'invited@example.com' });
    expect(repo.findPendingByHash).toHaveBeenCalledWith({
      tokenHash: await hashInvitationToken('valid_token_value_1234567890'),
      now,
    });
  });

  it('returns one generic error for unknown, expired, accepted, or revoked tokens', async () => {
    await expect(inspectInvitation({
      repository: repository({ findPendingByHash: vi.fn(async () => null) }),
      token: 'invalid_token_value_1234567890',
      now,
    })).rejects.toMatchObject({ code: 'INVALID_INVITATION', status: 400 });
  });

  it('lists invitations with pending-past-expiry surfaced as expired', async () => {
    const rows = [
      {
        id: 'invite_live', email: 'live@example.com', tokenPrefix: 'inv_live',
        status: 'pending' as const,
        expiresAt: new Date(now.getTime() + 60_000), createdAt: now,
      },
      {
        id: 'invite_stale', email: 'stale@example.com', tokenPrefix: 'inv_stale',
        status: 'pending' as const,
        expiresAt: new Date(now.getTime() - 60_000), createdAt: now,
      },
      {
        id: 'invite_done', email: 'done@example.com', tokenPrefix: 'inv_done',
        status: 'accepted' as const,
        expiresAt: new Date(now.getTime() - 60_000), createdAt: now,
      },
    ];
    const repo = repository({ list: vi.fn(async () => rows) });

    const summaries = await listInvitations({ repository: repo, now });

    expect(summaries.map((row) => row.status)).toEqual(['pending', 'expired', 'accepted']);
    expect(repo.list).toHaveBeenCalledWith(50);
  });

  it('revokes only pending invitations and reports a generic not-found error', async () => {
    await expect(revokeInvitation({
      repository: repository(), invitationId: 'invite_1', actorUserId: 'owner_1', now,
    })).resolves.toEqual({ revoked: true });
    await expect(revokeInvitation({
      repository: repository({ revoke: vi.fn(async () => false) }),
      invitationId: 'unknown',
      actorUserId: 'owner_1',
      now,
    })).rejects.toMatchObject({ code: 'INVITATION_NOT_FOUND', status: 404 });
  });
});
