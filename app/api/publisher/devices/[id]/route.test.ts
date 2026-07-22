import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  actor: { id: 'user_1' },
  database: { db: true },
  repository: { repository: true },
  assertAllowedOrigin: vi.fn(),
  requireActiveUser: vi.fn(),
  getRuntimeDatabase: vi.fn(),
  requireActorWorkspace: vi.fn(),
  createRepository: vi.fn(),
  revokeDevice: vi.fn(),
}));

vi.mock('@/server/auth/authorization', () => ({ requireActiveUser: mocks.requireActiveUser }));
vi.mock('@/server/auth/origin', () => ({ assertAllowedOrigin: mocks.assertAllowedOrigin }));
vi.mock('@/server/db/runtime', () => ({ getRuntimeDatabase: mocks.getRuntimeDatabase }));
vi.mock('@/server/modules/workspace/membership', () => ({
  requireActorWorkspace: mocks.requireActorWorkspace,
}));
vi.mock('@/server/modules/publisher/devices/repository', () => ({
  createPublisherDeviceRepository: mocks.createRepository,
}));
vi.mock('@/server/modules/publisher/devices/service', () => ({
  revokePublisherDevice: mocks.revokeDevice,
}));

describe('DELETE /api/publisher/devices/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveUser.mockResolvedValue(mocks.actor);
    mocks.getRuntimeDatabase.mockReturnValue(mocks.database);
    mocks.requireActorWorkspace.mockResolvedValue({ id: 'workspace_1' });
    mocks.createRepository.mockReturnValue(mocks.repository);
    mocks.revokeDevice.mockResolvedValue({ revoked: true });
  });

  it('revokes an owned active or pending device inside the resolved workspace', async () => {
    const { DELETE } = await import('./route');
    const request = new Request('https://articles.example.com/api/publisher/devices/device_1', {
      method: 'DELETE',
      headers: { origin: 'https://articles.example.com' },
    });
    const response = await DELETE(request as never, {
      params: Promise.resolve({ id: 'device_1' }),
    });

    expect(response.status).toBe(200);
    expect(mocks.assertAllowedOrigin).toHaveBeenCalledWith(request);
    expect(mocks.requireActiveUser).toHaveBeenCalledWith(request);
    expect(mocks.requireActorWorkspace).toHaveBeenCalledWith(mocks.database, 'user_1');
    expect(mocks.revokeDevice).toHaveBeenCalledWith({
      repository: mocks.repository,
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
      deviceId: 'device_1',
    });
    await expect(response.json()).resolves.toEqual({ revoked: true });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
