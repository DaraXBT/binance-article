import { describe, expect, it, vi } from 'vitest';

import { loadPublisherAsset } from './service';

describe('private publisher assets', () => {
  it('loads an authorized command asset by internal R2 key without exposing that key', async () => {
    const repository = {
      authorizeAsset: vi.fn(async () => ({
        r2Key: 'private/workspace/article/asset.png',
        mimeType: 'image/png' as const,
        sizeBytes: 8,
        sha256: 'a'.repeat(64),
      })),
    };
    const object = { body: new Uint8Array(8), size: 8, etag: 'etag-value' };
    const bucket = { get: vi.fn(async () => object) };

    const result = await loadPublisherAsset({
      repository,
      bucket,
      deviceId: 'device_1',
      commandId: 'command_1',
      assetId: 'asset_1',
    });

    expect(repository.authorizeAsset).toHaveBeenCalledWith({
      deviceId: 'device_1', commandId: 'command_1', assetId: 'asset_1',
    });
    expect(bucket.get).toHaveBeenCalledWith('private/workspace/article/asset.png');
    expect(result).toEqual({
      body: object.body,
      sizeBytes: 8,
      mimeType: 'image/png',
      sha256: 'a'.repeat(64),
      etag: 'etag-value',
    });
    expect(JSON.stringify(result)).not.toContain('private/workspace');
  });

  it('returns the same generic 404 for unauthorized DB metadata or missing R2 data', async () => {
    await expect(loadPublisherAsset({
      repository: { authorizeAsset: vi.fn(async () => null) },
      bucket: { get: vi.fn() },
      deviceId: 'device_1', commandId: 'command_1', assetId: 'asset_1',
    })).rejects.toMatchObject({ code: 'PUBLISHER_ASSET_NOT_FOUND', status: 404 });

    await expect(loadPublisherAsset({
      repository: { authorizeAsset: vi.fn(async () => ({
        r2Key: 'private/key', mimeType: 'image/png' as const, sizeBytes: 8, sha256: 'a'.repeat(64),
      })) },
      bucket: { get: vi.fn(async () => null) },
      deviceId: 'device_1', commandId: 'command_1', assetId: 'asset_1',
    })).rejects.toMatchObject({ code: 'PUBLISHER_ASSET_NOT_FOUND', status: 404 });
  });

  it('fails closed when R2 size differs from immutable database metadata', async () => {
    await expect(loadPublisherAsset({
      repository: { authorizeAsset: vi.fn(async () => ({
        r2Key: 'private/key', mimeType: 'image/png' as const, sizeBytes: 8, sha256: 'a'.repeat(64),
      })) },
      bucket: { get: vi.fn(async () => ({ body: new Uint8Array(7), size: 7 })) },
      deviceId: 'device_1', commandId: 'command_1', assetId: 'asset_1',
    })).rejects.toMatchObject({ code: 'PUBLISHER_ASSET_INTEGRITY_FAILED', status: 409 });
  });
});
