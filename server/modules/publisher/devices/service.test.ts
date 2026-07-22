import { describe, expect, it, vi } from 'vitest';

import { hashInvitationToken } from '@/server/domain/invitations';

import {
  DEVICE_PAIRING_LIFETIME_MS,
  activatePublisherDevice,
  authenticatePublisherDevice,
  createPublisherDevicePairing,
  listPublisherDevices,
  revokePublisherDevice,
} from './service';

const now = new Date('2026-07-19T00:00:00.000Z');
const pairingEntropy = Uint8Array.from({ length: 32 }, (_, index) => index);
const deviceEntropy = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);

function repository(overrides: Record<string, unknown> = {}) {
  return {
    createPending: vi.fn(async () => ({ id: 'device_1' })),
    activatePending: vi.fn(async () => ({ id: 'device_1', name: 'My Mac', protocolVersion: 1 })),
    authenticate: vi.fn(async () => ({
      id: 'device_1', userId: 'user_1', workspaceId: 'workspace_1', status: 'active' as const, protocolVersion: 1,
    })),
    listForUserWorkspace: vi.fn(async () => []),
    revokeForUserWorkspace: vi.fn(async () => true),
    ...overrides,
  };
}

describe('publisher device pairing', () => {
  it('returns a one-time pairing secret while storing only its hash', async () => {
    const repo = repository();
    const result = await createPublisherDevicePairing({
      repository: repo,
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
      name: 'My Mac',
      id: 'device_1',
      entropy: pairingEntropy,
      now,
    });

    expect(result.pairingCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.expiresAt).toEqual(new Date(now.getTime() + DEVICE_PAIRING_LIFETIME_MS));
    expect(repo.createPending).toHaveBeenCalledWith({
      id: 'device_1', userId: 'user_1', workspaceId: 'workspace_1', name: 'My Mac',
      tokenHash: await hashInvitationToken(result.pairingCode),
      tokenPrefix: result.pairingCode.slice(0, 8),
      now,
    });
    expect(JSON.stringify(repo.createPending.mock.calls)).not.toContain(result.pairingCode);
  });

  it('rotates a valid pairing code into a separate device bearer token', async () => {
    const repo = repository();
    const result = await activatePublisherDevice({
      repository: repo,
      pairingCode: 'pairing_code_value_12345678901234567890',
      entropy: deviceEntropy,
      now,
    });

    expect(result.deviceToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(repo.activatePending).toHaveBeenCalledWith({
      pairingHash: await hashInvitationToken('pairing_code_value_12345678901234567890'),
      deviceTokenHash: await hashInvitationToken(result.deviceToken),
      deviceTokenPrefix: result.deviceToken.slice(0, 8),
      notBefore: new Date(now.getTime() - DEVICE_PAIRING_LIFETIME_MS),
      now,
    });
    expect(JSON.stringify(repo.activatePending.mock.calls)).not.toContain(result.deviceToken);
  });

  it('rejects invalid, expired, used, or revoked pairing codes generically', async () => {
    await expect(activatePublisherDevice({
      repository: repository({ activatePending: vi.fn(async () => null) }),
      pairingCode: 'invalid_pairing_code_123456789012345',
      entropy: deviceEntropy,
      now,
    })).rejects.toMatchObject({ code: 'INVALID_PAIRING_CODE', status: 400 });
  });
});

describe('publisher device authentication', () => {
  it('hashes the bearer token and touches an active device', async () => {
    const repo = repository();
    const token = 'device_token_value_12345678901234567890';
    await expect(authenticatePublisherDevice({
      repository: repo,
      authorization: `Bearer ${token}`,
      now,
    })).resolves.toMatchObject({ id: 'device_1', status: 'active' });
    expect(repo.authenticate).toHaveBeenCalledWith({ tokenHash: await hashInvitationToken(token), now });
  });

  it.each([null, '', 'Basic abc', 'Bearer bad token'])('rejects malformed authorization: %s', async (authorization) => {
    await expect(authenticatePublisherDevice({ repository: repository(), authorization, now }))
      .rejects.toMatchObject({ code: 'PUBLISHER_AUTH_REQUIRED', status: 401 });
  });
});

describe('publisher device lifecycle', () => {
  it('lists only the actor devices in the resolved workspace', async () => {
    const devices = [{
      id: 'device_1',
      name: 'Studio Mac',
      status: 'active' as const,
      protocolVersion: 1,
      lastSeenAt: new Date('2026-07-22T03:00:00.000Z'),
    }];
    const repo = repository({ listForUserWorkspace: vi.fn(async () => devices) });

    await expect(listPublisherDevices({
      repository: repo,
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
    })).resolves.toEqual(devices);
    expect(repo.listForUserWorkspace).toHaveBeenCalledWith({
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
    });
  });

  it('revokes an active or pending device owned by the actor workspace', async () => {
    const repo = repository();

    await expect(revokePublisherDevice({
      repository: repo,
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
      deviceId: 'device_1',
      now,
    })).resolves.toEqual({ revoked: true });
    expect(repo.revokeForUserWorkspace).toHaveBeenCalledWith({
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
      deviceId: 'device_1',
      now,
    });
  });

  it('does not reveal whether a device is revoked or belongs to another user', async () => {
    await expect(revokePublisherDevice({
      repository: repository({ revokeForUserWorkspace: vi.fn(async () => false) }),
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
      deviceId: 'device_2',
      now,
    })).rejects.toMatchObject({ code: 'PUBLISHER_DEVICE_NOT_FOUND', status: 404 });
  });
});
