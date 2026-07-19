import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  database: { db: true },
  getRuntimeDatabase: vi.fn(),
  deviceRepository: { devices: true },
  commandRepository: { commands: true },
  createDeviceRepository: vi.fn(),
  createCommandRepository: vi.fn(),
  authenticateDevice: vi.fn(async () => ({ id: 'device_1', status: 'active' })),
  claimNext: vi.fn(async (): Promise<{ id: string; state: string; revision: number } | null> => ({
    id: 'command_1', state: 'claimed', revision: 3,
  })),
}));
mocks.getRuntimeDatabase.mockReturnValue(mocks.database);
mocks.createDeviceRepository.mockReturnValue(mocks.deviceRepository);
mocks.createCommandRepository.mockReturnValue(mocks.commandRepository);

vi.mock('@/server/db/runtime', () => ({ getRuntimeDatabase: mocks.getRuntimeDatabase }));
vi.mock('@/server/modules/publisher/devices/repository', () => ({
  createPublisherDeviceRepository: mocks.createDeviceRepository,
}));
vi.mock('@/server/modules/publisher/devices/service', () => ({
  authenticatePublisherDevice: mocks.authenticateDevice,
}));
vi.mock('@/server/modules/publisher/commands/repository', () => ({
  createPublisherCommandRepository: mocks.createCommandRepository,
}));
vi.mock('@/server/modules/publisher/commands/service', () => ({
  claimNextPublisherCommand: mocks.claimNext,
}));

describe('POST /api/publisher/commands/claim', () => {
  it('authenticates the local device and claims one command', async () => {
    const { POST } = await import('./route');
    const request = new Request('https://articles.example.com/api/publisher/commands/claim', {
      method: 'POST', headers: { authorization: 'Bearer opaque-device-token' },
    });
    const response = await POST(request as never);

    expect(response.status).toBe(200);
    expect(mocks.authenticateDevice).toHaveBeenCalledWith({
      repository: mocks.deviceRepository,
      authorization: 'Bearer opaque-device-token',
    });
    expect(mocks.claimNext).toHaveBeenCalledWith({
      repository: mocks.commandRepository, deviceId: 'device_1',
    });
    expect(await response.json()).toEqual({ command: { id: 'command_1', state: 'claimed', revision: 3 } });
  });

  it('returns 204 when there is no work', async () => {
    mocks.claimNext.mockResolvedValueOnce(null);
    const { POST } = await import('./route');
    const response = await POST(new Request('https://articles.example.com/api/publisher/commands/claim', {
      method: 'POST', headers: { authorization: 'Bearer opaque-device-token' },
    }) as never);
    expect(response.status).toBe(204);
  });
});
