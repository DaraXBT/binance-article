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
vi.mock('@/server/modules/publications/draft-repository', () => ({
  createPublicationDraftRepository: mocks.createRepository,
}));
vi.mock('@/server/modules/publications/draft-service', () => ({
  getPublicationDraft: mocks.getBinanceDraft,
  savePublicationDraft: mocks.saveBinanceDraft,
}));

const params = Promise.resolve({ id: 'article_1' });

describe('/api/articles/:id/publications/binance', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads an omitted-kind legacy draft through resolved membership', async () => {
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
      target: 'binance-square',
    });
  });

  it('saves an omitted-kind legacy draft with origin and membership checks', async () => {
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
      actorUserId: 'user_1', workspaceId: 'workspace_1', articleId: 'article_1',
      target: 'binance-square', input: body,
    }));
  });

  it('loads and saves an explicit Binance Post draft independently', async () => {
    const { GET, PUT } = await import('./route');
    await GET(new Request(
      'https://articles.example.com/api/articles/article_1/publications/binance?kind=post',
    ) as never, { params });
    expect(mocks.getBinanceDraft).toHaveBeenCalledWith(expect.objectContaining({
      target: 'binance-square', kind: 'post',
    }));

    const body = { kind: 'post', expectedRevision: 0, text: 'Post', orderedAssetIds: [] };
    const request = new Request(
      'https://articles.example.com/api/articles/article_1/publications/binance',
      {
        method: 'PUT',
        headers: { origin: 'https://articles.example.com', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    await PUT(request as never, { params });
    expect(mocks.saveBinanceDraft).toHaveBeenCalledWith(expect.objectContaining({
      target: 'binance-square', kind: 'post', input: body,
    }));
  });

  it('accepts a valid 100,000-character multilingual Article request', async () => {
    const { PUT } = await import('./route');
    const body = {
      kind: 'article', expectedRevision: 0, title: 'Large multilingual article',
      markdown: '界'.repeat(100_000), orderedAssetIds: [],
    };
    const response = await PUT(new Request(
      'https://articles.example.com/api/articles/article_1/publications/binance',
      {
        method: 'PUT',
        headers: { origin: 'https://articles.example.com', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    ) as never, { params });

    expect(response.status).toBe(200);
    expect(mocks.saveBinanceDraft).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'article', input: body,
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
