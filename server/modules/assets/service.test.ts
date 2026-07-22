import { describe, expect, it, vi } from 'vitest';

import {
  loadArticleAsset,
  storeArticleAsset,
  type ArticleAssetMetadata,
} from './service';

function bucket() {
  return {
    put: vi.fn(async () => ({ size: 3, etag: 'etag_new' })),
    get: vi.fn(async () => ({
      body: new Uint8Array([1, 2, 3]), size: 3, etag: 'etag_new',
      httpMetadata: { contentType: 'image/png' },
    })),
    delete: vi.fn(async () => undefined),
  };
}

describe('private R2 article asset service', () => {
  it('hashes, stores, records, and returns only an opaque reference', async () => {
    const storage = bucket();
    const repository = {
      replaceAsset: vi.fn(async () => ({ assetId: 'asset_1', retiredR2Keys: ['old/key.png'] })),
      authorizeAsset: vi.fn(),
    };

    const stored = await storeArticleAsset({
      repository, bucket: storage, workspaceId: 'workspace_1', articleId: 'article_1',
      slideId: 'slide_1', assetId: 'asset_1', filename: 'slide-01.png',
      mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]),
      now: new Date('2026-07-19T12:00:00.000Z'),
    });

    expect(stored.reference).toBe('r2://article-assets/asset_1/slide-01.png');
    expect(stored).not.toHaveProperty('url');
    expect(storage.put).toHaveBeenCalledWith(
      expect.stringMatching(/^workspaces\/workspace_1\/articles\/article_1\/slides\/slide_1\//),
      expect.any(Uint8Array),
      expect.objectContaining({ httpMetadata: { contentType: 'image/png' } }),
    );
    expect(repository.replaceAsset).toHaveBeenCalledWith(expect.objectContaining({
      assetId: 'asset_1', workspaceId: 'workspace_1', articleId: 'article_1',
      sizeBytes: 3, sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(storage.delete).toHaveBeenCalledWith('old/key.png');
  });

  it('deletes the newly uploaded object when metadata persistence fails', async () => {
    const storage = bucket();
    const repository = {
      replaceAsset: vi.fn(async () => { throw new Error('database unavailable'); }),
      authorizeAsset: vi.fn(),
    };

    await expect(storeArticleAsset({
      repository, bucket: storage, workspaceId: 'workspace_1', articleId: 'article_1',
      slideId: 'slide_1', assetId: 'asset_1', filename: 'slide-01.png',
      mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]),
    })).rejects.toThrow('database unavailable');
    expect(storage.delete).toHaveBeenCalledWith(expect.stringContaining('asset_1'));
  });

  it('stores a dedicated cover under a revision-scoped cover prefix', async () => {
    const storage = bucket();
    const repository = {
      replaceAsset: vi.fn(async () => ({ assetId: 'cover_asset', retiredR2Keys: [] })),
      authorizeAsset: vi.fn(),
    };
    const stored = await storeArticleAsset({
      repository,
      bucket: storage,
      workspaceId: 'workspace_1',
      articleId: 'article_1',
      purpose: 'cover_image',
      assetScope: 'rev-2',
      assetId: 'cover_asset',
      filename: 'cover-source.png',
      mimeType: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(stored.reference).toBe('r2://article-assets/cover_asset/cover-source.png');
    expect(storage.put).toHaveBeenCalledWith(
      expect.stringMatching(/\/covers\/rev-2\/cover_asset\.png$/),
      expect.any(Uint8Array),
      expect.objectContaining({ customMetadata: expect.objectContaining({ purpose: 'cover_image' }) }),
    );
    expect(repository.replaceAsset).toHaveBeenCalledWith(expect.objectContaining({
      purpose: 'cover_image',
      assetKeyPrefix: expect.stringContaining('/covers/rev-2/'),
    }));
  });

  it('loads only repository-authorized objects and verifies their size', async () => {
    const storage = bucket();
    const repository = {
      replaceAsset: vi.fn(),
      authorizeAsset: vi.fn(async () => ({
        r2Key: 'private/key.png', mimeType: 'image/png' as const,
        sizeBytes: 3, sha256: 'a'.repeat(64),
      })),
    };

    await expect(loadArticleAsset({
      repository, bucket: storage, workspaceId: 'workspace_1', articleId: 'article_1',
      assetId: 'asset_1',
    })).resolves.toMatchObject({ mimeType: 'image/png', sizeBytes: 3 });
    expect(storage.get).toHaveBeenCalledWith('private/key.png');
  });

  it('returns an opaque 404 for missing metadata, objects, or size mismatches', async () => {
    const storage = bucket();
    const repository = {
      replaceAsset: vi.fn(),
      authorizeAsset: vi.fn(async (): Promise<ArticleAssetMetadata | null> => null),
    };
    const input = {
      repository, bucket: storage, workspaceId: 'workspace_1', articleId: 'article_1',
      assetId: 'asset_1',
    };
    await expect(loadArticleAsset(input)).rejects.toMatchObject({ status: 404 });

    repository.authorizeAsset.mockResolvedValueOnce({
      r2Key: 'private/key.png', mimeType: 'image/png', sizeBytes: 4, sha256: 'a'.repeat(64),
    });
    await expect(loadArticleAsset(input)).rejects.toMatchObject({
      code: 'ARTICLE_ASSET_INTEGRITY_FAILED', status: 409,
    });
  });
});
