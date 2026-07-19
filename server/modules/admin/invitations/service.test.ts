import { describe, expect, it, vi } from 'vitest';

import { INVITATION_LIFETIME_MS, hashInvitationToken } from '@/server/domain/invitations';

import {
  MAX_ACTIVE_BETA_USERS,
  createInvitation,
  inspectInvitation,
  revokeInvitation,
} from './service';

const now = new Date('2026-07-19T00:00:00.000Z');
const entropy = Uint8Array.from({ length: 32 }, (_, index) => index);

function repository(overrides: Record<string, unknown> = {}) {
  return {
    countActiveUsersAndPendingInvitations: vi.fn(async () => 3),
    insert: vi.fn(async () => undefined),
    findPendingByHash: vi.fn(async () => ({
      id: 'invite_1',
      email: 'invited@example.com',
      expiresAt: new Date(now.getTime() + INVITATION_LIFETIME_MS),
    })),
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
    expect(repo.insert).toHaveBeenCalledWith({
      id: 'invite_1',
      email: 'invited@example.com',
      tokenHash: await hashInvitationToken(result.token),
      tokenPrefix: result.token.slice(0, 8),
      createdByUserId: 'owner_1',
      expiresAt: result.expiresAt,
      now,
    });
    expect(JSON.stringify(repo.insert.mock.calls)).not.toContain(result.token);
  });

  it('enforces the ten-user global beta cap before creating another invitation', async () => {
    const repo = repository({
      countActiveUsersAndPendingInvitations: vi.fn(async () => MAX_ACTIVE_BETA_USERS),
    });

    await expect(createInvitation({
      repository: repo,
      actorUserId: 'owner_1',
      email: 'invited@example.com',
      now,
      entropy,
      id: 'invite_1',
    })).rejects.toMatchObject({ code: 'BETA_USER_CAP_REACHED', status: 409 });
    expect(repo.insert).not.toHaveBeenCalled();
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
