import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/server/http/errors';

const mocks = vi.hoisted(() => ({
  database: { db: true },
  bucket: { private: true },
  deviceRepository: { devices: true },
  assetRepository: { assets: true },
  getRuntimeDatabase: vi.fn(),
  getArticleAssetsBucket: vi.fn(),
  createDeviceRepository: vi.fn(),
  createAssetRepository: vi.fn(),
  authenticateDevice: vi.fn(),
  loadAsset: vi.fn(),
}));

vi.mock('@/server/db/runtime', () => ({
  getRuntimeDatabase: mocks.getRuntimeDatabase,
}));
vi.mock('@/server/cloudflare/article-assets', () => ({
  getArticleAssetsBucket: mocks.getArticleAssetsBucket,
}));
vi.mock('@/server/modules/publisher/devices/repository', () => ({
  createPublisherDeviceRepository: mocks.createDeviceRepository,
}));
vi.mock('@/server/modules/publisher/devices/service', () => ({
  authenticatePublisherDevice: mocks.authenticateDevice,
}));
vi.mock('@/server/modules/publisher/assets/repository', () => ({
  createPublisherAssetRepository: mocks.createAssetRepository,
}));
vi.mock('@/server/modules/publisher/assets/service', () => ({
  loadPublisherAsset: mocks.loadAsset,
}));

describe('GET /api/publisher/commands/:commandId/assets/:assetId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRuntimeDatabase.mockReturnValue(mocks.database);
    mocks.getArticleAssetsBucket.mockReturnValue(mocks.bucket);
    mocks.createDeviceRepository.mockReturnValue(mocks.deviceRepository);
    mocks.createAssetRepository.mockReturnValue(mocks.assetRepository);
    mocks.authenticateDevice.mockResolvedValue({ id: 'device_1', status: 'active' });
    mocks.loadAsset.mockResolvedValue({
      body: new Uint8Array([137, 80, 78, 71]),
      sizeBytes: 4,
      mimeType: 'image/png',
      sha256: 'a'.repeat(64),
      etag: 'r2-etag',
    });
  });

  it('streams an authorized private object with integrity and anti-cache headers', async () => {
    const { GET } = await import('./route');
    const request = new Request(
      'https://articles.example.com/api/publisher/commands/command_1/assets/asset_1',
      { headers: { authorization: 'Bearer opaque-device-token' } },
    );

    const response = await GET(request as never, {
      params: Promise.resolve({ commandId: 'command_1', assetId: 'asset_1' }),
    });

    expect(response.status).toBe(200);
    expect(mocks.authenticateDevice).toHaveBeenCalledWith({
      repository: mocks.deviceRepository,
      authorization: 'Bearer opaque-device-token',
    });
    expect(mocks.loadAsset).toHaveBeenCalledWith({
      repository: mocks.assetRepository,
      bucket: mocks.bucket,
      deviceId: 'device_1',
      commandId: 'command_1',
      assetId: 'asset_1',
    });
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Content-Length')).toBe('4');
    expect(response.headers.get('X-Content-SHA256')).toBe('a'.repeat(64));
    expect(response.headers.get('ETag')).toBe('"r2-etag"');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([137, 80, 78, 71]);
  });

  it('does not synthesize an ETag when R2 has none', async () => {
    mocks.loadAsset.mockResolvedValue({
      body: new Uint8Array([1]),
      sizeBytes: 1,
      mimeType: 'image/webp',
      sha256: 'b'.repeat(64),
    });

    const { GET } = await import('./route');
    const response = await GET(
      new Request('https://articles.example.com/api/publisher/commands/c/assets/a', {
        headers: { authorization: 'Bearer opaque-device-token' },
      }) as never,
      { params: Promise.resolve({ commandId: 'c', assetId: 'a' }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.has('ETag')).toBe(false);
  });

  it('keeps authentication and missing-object failures generic and non-cacheable', async () => {
    mocks.authenticateDevice.mockRejectedValueOnce(new AppError({
      code: 'PUBLISHER_AUTH_REQUIRED',
      message: 'Publisher device authentication is required.',
      status: 401,
    }));

    const { GET } = await import('./route');
    const unauthorized = await GET(
      new Request('https://articles.example.com/api/publisher/commands/c/assets/a') as never,
      { params: Promise.resolve({ commandId: 'c', assetId: 'a' }) },
    );
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('Cache-Control')).toBe('no-store');
    expect(await unauthorized.json()).toEqual({
      error: 'Publisher device authentication is required.',
      code: 'PUBLISHER_AUTH_REQUIRED',
    });

    mocks.loadAsset.mockRejectedValueOnce(new AppError({
      code: 'PUBLISHER_ASSET_NOT_FOUND',
      message: 'Publisher asset not found.',
      status: 404,
    }));
    const missing = await GET(
      new Request('https://articles.example.com/api/publisher/commands/c/assets/missing', {
        headers: { authorization: 'Bearer opaque-device-token' },
      }) as never,
      { params: Promise.resolve({ commandId: 'c', assetId: 'missing' }) },
    );
    expect(missing.status).toBe(404);
    expect(missing.headers.get('Cache-Control')).toBe('no-store');
    expect(await missing.json()).toEqual({
      error: 'Publisher asset not found.',
      code: 'PUBLISHER_ASSET_NOT_FOUND',
    });
  });
});
