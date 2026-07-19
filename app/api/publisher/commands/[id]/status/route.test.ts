import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  database: { db: true }, deviceRepository: { devices: true }, commandRepository: { commands: true },
  getRuntimeDatabase: vi.fn(), createDeviceRepository: vi.fn(), createCommandRepository: vi.fn(),
  authenticateDevice: vi.fn(async () => ({ id: 'device_1', status: 'active' })),
  getStatus: vi.fn(async () => ({
    id: 'command_1', state: 'approved', revision: 3, recipeHash: 'a'.repeat(64),
    expiresAt: new Date('2026-07-19T00:15:00Z'),
  })),
}));
mocks.getRuntimeDatabase.mockReturnValue(mocks.database);
mocks.createDeviceRepository.mockReturnValue(mocks.deviceRepository);
mocks.createCommandRepository.mockReturnValue(mocks.commandRepository);
vi.mock('@/server/db/runtime', () => ({ getRuntimeDatabase: mocks.getRuntimeDatabase }));
vi.mock('@/server/modules/publisher/devices/repository', () => ({ createPublisherDeviceRepository: mocks.createDeviceRepository }));
vi.mock('@/server/modules/publisher/devices/service', () => ({ authenticatePublisherDevice: mocks.authenticateDevice }));
vi.mock('@/server/modules/publisher/commands/repository', () => ({ createPublisherCommandRepository: mocks.createCommandRepository }));
vi.mock('@/server/modules/publisher/commands/service', () => ({ getPublisherCommandStatus: mocks.getStatus }));

describe('GET /api/publisher/commands/:id/status', () => {
  it('returns no-store metadata for the assigned authenticated device', async () => {
    const { GET } = await import('./route');
    const response = await GET(new Request('https://app.example/api/publisher/commands/command_1/status', {
      headers: { authorization: 'Bearer opaque-device-token' },
    }) as never, { params: Promise.resolve({ id: 'command_1' }) });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.getStatus).toHaveBeenCalledWith({
      repository: mocks.commandRepository, deviceId: 'device_1', commandId: 'command_1',
    });
    expect(await response.json()).toEqual({
      command: {
        id: 'command_1', state: 'approved', revision: 3, recipeHash: 'a'.repeat(64),
        expiresAt: '2026-07-19T00:15:00.000Z',
      },
    });
  });
});
