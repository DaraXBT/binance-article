import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = { getDeckWithAssets: vi.fn() };
const articleAuthorizationMock = {
  authorizeArticleRequest: vi.fn(async () => ({ workspaceId: 'workspace_1' })),
};
const assetServiceMock = { loadArticleAsset: vi.fn() };
const assetRepositoryMock = { createArticleAssetRepository: vi.fn(() => ({ repository: true })) };
const runtimeMock = { getRuntimeDatabase: vi.fn(() => ({ database: true })) };
const bucketMock = { getArticleAssetsBucket: vi.fn(() => ({ bucket: true })) };

vi.mock('@/lib/db', () => dbMock);
vi.mock('@/server/auth/article-authorization', () => articleAuthorizationMock);
vi.mock('@/server/modules/assets/service', () => assetServiceMock);
vi.mock('@/server/modules/assets/repository', () => assetRepositoryMock);
vi.mock('@/server/db/runtime', () => runtimeMock);
vi.mock('@/server/cloudflare/article-assets', () => bucketMock);

describe('GET /api/articles/[id]/assets/[filename]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assetServiceMock.loadArticleAsset.mockResolvedValue({
      body: new Uint8Array([1, 2, 3]), mimeType: 'image/png', sizeBytes: 3,
    });
  });

  it('returns 404 without touching R2 when the article is outside the workspace', async () => {
    dbMock.getDeckWithAssets.mockResolvedValue(null);
    const { GET } = await import('@/app/api/articles/[id]/assets/[filename]/route');
    const response = await GET(
      new Request('http://localhost/api/articles/deck_1/assets/slide-01.png') as never,
      { params: Promise.resolve({ id: 'deck_1', filename: 'slide-01.png' }) },
    );

    expect(response.status).toBe(404);
    expect(assetServiceMock.loadArticleAsset).not.toHaveBeenCalled();
  });

  it('serves an authorized private R2 object with no-store headers', async () => {
    dbMock.getDeckWithAssets.mockResolvedValue({
      id: 'deck_1',
      slides: [{ id: 'slide_1', imageUrl: 'r2://article-assets/asset_1/slide-01.png' }],
    });
    const { GET } = await import('@/app/api/articles/[id]/assets/[filename]/route');
    const response = await GET(
      new Request('http://localhost/api/articles/deck_1/assets/slide-01.png') as never,
      { params: Promise.resolve({ id: 'deck_1', filename: 'slide-01.png' }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Content-Disposition')).toBe('inline; filename="slide-01.png"');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([1, 2, 3]);
    expect(assetServiceMock.loadArticleAsset).toHaveBeenCalledWith({
      repository: { repository: true }, bucket: { bucket: true },
      workspaceId: 'workspace_1', articleId: 'deck_1', assetId: 'asset_1',
    });
  });

  it('uses attachment disposition only when explicitly requested', async () => {
    dbMock.getDeckWithAssets.mockResolvedValue({
      id: 'deck_1',
      slides: [{ id: 'slide_1', imageUrl: 'r2://article-assets/asset_1/slide-01.png' }],
    });
    const { GET } = await import('@/app/api/articles/[id]/assets/[filename]/route');
    const response = await GET(
      new Request('http://localhost/api/articles/deck_1/assets/slide-01.png?download=1') as never,
      { params: Promise.resolve({ id: 'deck_1', filename: 'slide-01.png' }) },
    );
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="slide-01.png"');
  });

  it('does not allow one current slide reference to fetch another asset or filename', async () => {
    dbMock.getDeckWithAssets.mockResolvedValue({
      id: 'deck_1',
      slides: [{ id: 'slide_1', imageUrl: 'r2://article-assets/asset_2/slide-02.png' }],
    });
    const { GET } = await import('@/app/api/articles/[id]/assets/[filename]/route');
    const response = await GET(
      new Request('http://localhost/api/articles/deck_1/assets/slide-01.png') as never,
      { params: Promise.resolve({ id: 'deck_1', filename: 'slide-01.png' }) },
    );
    expect(response.status).toBe(404);
    expect(assetServiceMock.loadArticleAsset).not.toHaveBeenCalled();
  });
});
