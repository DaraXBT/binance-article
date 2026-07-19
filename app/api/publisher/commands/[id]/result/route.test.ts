import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  database: { db: true },
  getRuntimeDatabase: vi.fn(),
  deviceRepository: { devices: true },
  commandRepository: { commands: true },
  createDeviceRepository: vi.fn(),
  createCommandRepository: vi.fn(),
  authenticateDevice: vi.fn(async () => ({ id: 'device_1', status: 'active' })),
  reportResult: vi.fn(async () => ({ state: 'succeeded' })),
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
vi.mock('@/server/modules/publisher/commands/service', () => ({ reportPublishResult: mocks.reportResult }));

describe('POST /api/publisher/commands/:id/result', () => {
  it('records an exact device result without accepting client-selected device IDs', async () => {
    const { POST } = await import('./route');
    const body = {
      revision: 3,
      outcome: 'succeeded',
      publishedUrl: 'https://www.binance.com/en/square/post/123',
    };
    const request = new Request('https://articles.example.com/api/publisher/commands/command_1/result', {
      method: 'POST',
      headers: { authorization: 'Bearer opaque-device-token', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const response = await POST(request as never, { params: Promise.resolve({ id: 'command_1' }) });

    expect(response.status).toBe(200);
    expect(mocks.reportResult).toHaveBeenCalledWith({
      repository: mocks.commandRepository,
      deviceId: 'device_1',
      commandId: 'command_1',
      ...body,
    });
    expect(await response.json()).toEqual({ state: 'succeeded' });
  });
});
