import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  actor: { id: 'user_1' },
  requireActiveUser: vi.fn(),
  assertAllowedOrigin: vi.fn(),
  database: { db: true },
  getRuntimeDatabase: vi.fn(),
  repository: { repository: true },
  createRepository: vi.fn(),
  createPairing: vi.fn(async () => ({
    deviceId: 'device_1', pairingCode: 'pairing_secret', tokenPrefix: 'pairing_',
    expiresAt: new Date('2026-07-19T00:10:00.000Z'),
  })),
}));
mocks.requireActiveUser.mockResolvedValue(mocks.actor);
mocks.getRuntimeDatabase.mockReturnValue(mocks.database);
mocks.createRepository.mockReturnValue(mocks.repository);

vi.mock('@/server/auth/authorization', () => ({ requireActiveUser: mocks.requireActiveUser }));
vi.mock('@/server/auth/origin', () => ({ assertAllowedOrigin: mocks.assertAllowedOrigin }));
vi.mock('@/server/db/runtime', () => ({ getRuntimeDatabase: mocks.getRuntimeDatabase }));
vi.mock('@/server/modules/publisher/devices/repository', () => ({
  createPublisherDeviceRepository: mocks.createRepository,
}));
vi.mock('@/server/modules/publisher/devices/service', () => ({
  createPublisherDevicePairing: mocks.createPairing,
}));

describe('POST /api/publisher/devices/pairing', () => {
  it('returns a one-time code only to an authenticated user', async () => {
    const { POST } = await import('./route');
    const request = new Request('https://articles.example.com/api/publisher/devices/pairing', {
      method: 'POST',
      headers: { origin: 'https://articles.example.com', 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'workspace_1', name: 'My Mac' }),
    });
    const response = await POST(request as never);

    expect(response.status).toBe(201);
    expect(mocks.createPairing).toHaveBeenCalledWith({
      repository: mocks.repository,
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
      name: 'My Mac',
    });
    expect(await response.json()).toEqual({
      deviceId: 'device_1', pairingCode: 'pairing_secret', tokenPrefix: 'pairing_',
      expiresAt: '2026-07-19T00:10:00.000Z',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
