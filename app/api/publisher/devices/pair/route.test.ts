import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertAllowedOrigin: vi.fn(),
  database: { db: true },
  getRuntimeDatabase: vi.fn(),
  repository: { repository: true },
  createRepository: vi.fn(),
  activate: vi.fn(async () => ({
    device: { id: 'device_1', name: 'My Mac', protocolVersion: 1 },
    deviceToken: 'device_secret_returned_once',
  })),
}));
mocks.getRuntimeDatabase.mockReturnValue(mocks.database);
mocks.createRepository.mockReturnValue(mocks.repository);

vi.mock('@/server/auth/origin', () => ({ assertAllowedOrigin: mocks.assertAllowedOrigin }));
vi.mock('@/server/db/runtime', () => ({ getRuntimeDatabase: mocks.getRuntimeDatabase }));
vi.mock('@/server/modules/publisher/devices/repository', () => ({
  createPublisherDeviceRepository: mocks.createRepository,
}));
vi.mock('@/server/modules/publisher/devices/service', () => ({ activatePublisherDevice: mocks.activate }));

describe('POST /api/publisher/devices/pair', () => {
  it('exchanges the one-time pairing code for a separate device token', async () => {
    const { POST } = await import('./route');
    const request = new Request('https://articles.example.com/api/publisher/devices/pair', {
      method: 'POST',
      headers: { origin: 'https://articles.example.com', 'content-type': 'application/json' },
      body: JSON.stringify({ pairingCode: 'pairing_secret', protocolVersion: 2 }),
    });
    const response = await POST(request as never);

    expect(response.status).toBe(200);
    expect(mocks.activate).toHaveBeenCalledWith({
      repository: mocks.repository,
      pairingCode: 'pairing_secret',
      protocolVersion: 2,
    });
    expect(await response.json()).toEqual({
      device: { id: 'device_1', name: 'My Mac', protocolVersion: 1 },
      deviceToken: 'device_secret_returned_once',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
