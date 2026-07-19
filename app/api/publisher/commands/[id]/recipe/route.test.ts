import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  database: { db: true },
  getRuntimeDatabase: vi.fn(),
  deviceRepository: { devices: true },
  commandRepository: { commands: true },
  createDeviceRepository: vi.fn(),
  createCommandRepository: vi.fn(),
  authenticateDevice: vi.fn(async () => ({ id: 'device_1', status: 'active' })),
  loadRecipe: vi.fn(async () => ({ version: 1, draftId: 'draft_1', revision: 3, title: 'Title' })),
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
vi.mock('@/server/modules/publisher/commands/service', () => ({ loadPublisherRecipe: mocks.loadRecipe }));

describe('GET /api/publisher/commands/:id/recipe', () => {
  it('returns the verified recipe only to the assigned authenticated device', async () => {
    const { GET } = await import('./route');
    const request = new Request('https://articles.example.com/api/publisher/commands/command_1/recipe', {
      headers: { authorization: 'Bearer opaque-device-token' },
    });
    const response = await GET(request as never, { params: Promise.resolve({ id: 'command_1' }) });
    expect(response.status).toBe(200);
    expect(mocks.loadRecipe).toHaveBeenCalledWith({
      repository: mocks.commandRepository, deviceId: 'device_1', commandId: 'command_1',
    });
    expect(await response.json()).toMatchObject({ recipe: { version: 1, draftId: 'draft_1' } });
  });
});
