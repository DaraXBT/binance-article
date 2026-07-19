import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireActiveUser: vi.fn(async () => ({ id: 'user_1' })),
  assertAllowedOrigin: vi.fn(),
  database: { db: true },
  getRuntimeDatabase: vi.fn(),
  resolveArticleWorkspace: vi.fn(async (): Promise<string | null> => 'workspace_1'),
  repository: { repository: true },
  createRepository: vi.fn(),
  getBinanceDraft: vi.fn(async () => ({ id: 'draft_1', revision: 2 })),
  saveBinanceDraft: vi.fn(async () => ({ id: 'draft_1', revision: 3 })),
}));
mocks.getRuntimeDatabase.mockReturnValue(mocks.database);
mocks.createRepository.mockReturnValue(mocks.repository);

vi.mock('@/server/auth/authorization', () => ({ requireActiveUser: mocks.requireActiveUser }));
vi.mock('@/server/auth/origin', () => ({ assertAllowedOrigin: mocks.assertAllowedOrigin }));
vi.mock('@/server/db/runtime', () => ({ getRuntimeDatabase: mocks.getRuntimeDatabase }));
vi.mock('@/server/modules/workspace/membership', () => ({ resolveArticleWorkspace: mocks.resolveArticleWorkspace }));
vi.mock('@/server/modules/publications/binance/draft-repository', () => ({
  createBinanceDraftRepository: mocks.createRepository,
}));
vi.mock('@/server/modules/publications/binance/draft-service', () => ({
  getBinanceDraft: mocks.getBinanceDraft,
  saveBinanceDraft: mocks.saveBinanceDraft,
}));

const params = Promise.resolve({ id: 'article_1' });

describe('/api/articles/:id/publications/binance', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads the authenticated actor draft through resolved membership', async () => {
    const { GET } = await import('./route');
    const request = new Request('https://articles.example.com/api/articles/article_1/publications/binance');
    const response = await GET(request as never, { params });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ draft: { id: 'draft_1', revision: 2 } });
    expect(mocks.resolveArticleWorkspace).toHaveBeenCalledWith(mocks.database, 'user_1', 'article_1');
    expect(mocks.getBinanceDraft).toHaveBeenCalledWith({
      repository: mocks.repository,
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
      articleId: 'article_1',
    });
  });

  it('saves a draft with origin and membership checks', async () => {
    const { PUT } = await import('./route');
    const body = {
      expectedRevision: 2,
      title: 'Title',
      markdown: 'Body',
      cover: { assetId: 'asset_1', focalX: 0.5, focalY: 0.5 },
      orderedAssetIds: ['asset_1'],
    };
    const request = new Request('https://articles.example.com/api/articles/article_1/publications/binance', {
      method: 'PUT',
      headers: { origin: 'https://articles.example.com', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const response = await PUT(request as never, { params });

    expect(response.status).toBe(200);
    expect(mocks.assertAllowedOrigin).toHaveBeenCalledWith(request);
    expect(mocks.saveBinanceDraft).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'user_1', workspaceId: 'workspace_1', articleId: 'article_1', input: body,
    }));
  });

  it('returns 404 without revealing a cross-workspace article', async () => {
    mocks.resolveArticleWorkspace.mockResolvedValueOnce(null);
    const { GET } = await import('./route');
    const response = await GET(
      new Request('https://articles.example.com/api/articles/other/publications/binance') as never,
      { params: Promise.resolve({ id: 'other' }) },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'ARTICLE_NOT_FOUND' });
  });
});
