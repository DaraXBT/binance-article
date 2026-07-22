import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  actor: { id: 'user_1' },
  database: { db: true },
  repository: { repository: true },
  requireActiveUser: vi.fn(),
  getRuntimeDatabase: vi.fn(),
  requireActorWorkspace: vi.fn(),
  createRepository: vi.fn(),
  listDevices: vi.fn(),
}));

vi.mock('@/server/auth/authorization', () => ({ requireActiveUser: mocks.requireActiveUser }));
vi.mock('@/server/db/runtime', () => ({ getRuntimeDatabase: mocks.getRuntimeDatabase }));
vi.mock('@/server/modules/workspace/membership', () => ({
  requireActorWorkspace: mocks.requireActorWorkspace,
}));
vi.mock('@/server/modules/publisher/devices/repository', () => ({
  createPublisherDeviceRepository: mocks.createRepository,
}));
vi.mock('@/server/modules/publisher/devices/service', () => ({
  listPublisherDevices: mocks.listDevices,
}));

describe('GET /api/publisher/devices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveUser.mockResolvedValue(mocks.actor);
    mocks.getRuntimeDatabase.mockReturnValue(mocks.database);
    mocks.requireActorWorkspace.mockResolvedValue({ id: 'workspace_1' });
    mocks.createRepository.mockReturnValue(mocks.repository);
    mocks.listDevices.mockResolvedValue([
      {
        id: 'device_1',
        name: 'Studio Mac',
        status: 'active',
        protocolVersion: 1,
        lastSeenAt: new Date('2026-07-22T03:00:00.000Z'),
      },
      {
        id: 'device_2',
        name: 'Travel Mac',
        status: 'pending',
        protocolVersion: 1,
        lastSeenAt: null,
      },
    ]);
  });

  it('returns the signed-in actor devices from their resolved workspace', async () => {
    const { GET } = await import('./route');
    const request = new Request('https://articles.example.com/api/publisher/devices');
    const response = await GET(request as never);

    expect(response.status).toBe(200);
    expect(mocks.requireActiveUser).toHaveBeenCalledWith(request);
    expect(mocks.requireActorWorkspace).toHaveBeenCalledWith(mocks.database, 'user_1');
    expect(mocks.listDevices).toHaveBeenCalledWith({
      repository: mocks.repository,
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
    });
    await expect(response.json()).resolves.toEqual({
      devices: [
        {
          id: 'device_1',
          name: 'Studio Mac',
          status: 'active',
          protocolVersion: 1,
          lastSeenAt: '2026-07-22T03:00:00.000Z',
        },
        {
          id: 'device_2',
          name: 'Travel Mac',
          status: 'pending',
          protocolVersion: 1,
          lastSeenAt: null,
        },
      ],
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
