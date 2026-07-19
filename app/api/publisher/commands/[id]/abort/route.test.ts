import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  database: { db: true }, deviceRepository: { devices: true }, commandRepository: { commands: true },
  getRuntimeDatabase: vi.fn(), createDeviceRepository: vi.fn(), createCommandRepository: vi.fn(),
  authenticateDevice: vi.fn(async () => ({ id: 'device_1', status: 'active' })),
  abort: vi.fn(async () => ({ state: 'cancelled' })),
}));
mocks.getRuntimeDatabase.mockReturnValue(mocks.database);
mocks.createDeviceRepository.mockReturnValue(mocks.deviceRepository);
mocks.createCommandRepository.mockReturnValue(mocks.commandRepository);
vi.mock('@/server/db/runtime', () => ({ getRuntimeDatabase: mocks.getRuntimeDatabase }));
vi.mock('@/server/modules/publisher/devices/repository', () => ({ createPublisherDeviceRepository: mocks.createDeviceRepository }));
vi.mock('@/server/modules/publisher/devices/service', () => ({ authenticatePublisherDevice: mocks.authenticateDevice }));
vi.mock('@/server/modules/publisher/commands/repository', () => ({ createPublisherCommandRepository: mocks.createCommandRepository }));
vi.mock('@/server/modules/publisher/commands/service', () => ({ abortPublisherCommand: mocks.abort }));

describe('POST /api/publisher/commands/:id/abort', () => {
  it('accepts only a revision and fixed reason code from the assigned device', async () => {
    const { POST } = await import('./route');
    const response = await POST(new Request('https://app.example/api/publisher/commands/command_1/abort', {
      method: 'POST',
      headers: { authorization: 'Bearer opaque-device-token', 'content-type': 'application/json' },
      body: JSON.stringify({ revision: 3, reasonCode: 'EDITOR_COMPOSITION_FAILED' }),
    }) as never, { params: Promise.resolve({ id: 'command_1' }) });
    expect(response.status).toBe(200);
    expect(mocks.abort).toHaveBeenCalledWith({
      repository: mocks.commandRepository, deviceId: 'device_1', commandId: 'command_1',
      revision: 3, reasonCode: 'EDITOR_COMPOSITION_FAILED',
    });
    expect(await response.json()).toEqual({ state: 'cancelled' });
  });
});
