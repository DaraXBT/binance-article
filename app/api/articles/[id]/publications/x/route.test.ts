import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireActiveUser: vi.fn(async () => ({ id: 'user_1' })),
  assertAllowedOrigin: vi.fn(),
  database: { db: true },
  getRuntimeDatabase: vi.fn(),
  resolveArticleWorkspace: vi.fn(async () => 'workspace_1'),
  repository: { repository: true },
  createRepository: vi.fn(),
  getDraft: vi.fn(async () => ({ id: 'draft_x', target: 'x', revision: 1 })),
  saveDraft: vi.fn(async () => ({ id: 'draft_x', target: 'x', revision: 2 })),
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
  getPublicationDraft: mocks.getDraft,
  savePublicationDraft: mocks.saveDraft,
}));

describe('/api/articles/:id/publications/x', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saves a target-bound regular X draft', async () => {
    const { PUT } = await import('./route');
    const body = { expectedRevision: 1, text: 'Post', orderedAssetIds: ['asset_1'] };
    const request = new Request('https://articles.example.com/api/articles/article_1/publications/x', {
      method: 'PUT',
      headers: { origin: 'https://articles.example.com', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const response = await PUT(request as never, { params: Promise.resolve({ id: 'article_1' }) });
    expect(response.status).toBe(200);
    expect(mocks.saveDraft).toHaveBeenCalledWith({
      repository: mocks.repository,
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
      articleId: 'article_1',
      target: 'x',
      input: body,
    });
    expect(await response.json()).toMatchObject({ draft: { target: 'x', revision: 2 } });
  });

  it('loads and saves an explicit X Article draft independently', async () => {
    const { GET, PUT } = await import('./route');
    await GET(new Request(
      'https://articles.example.com/api/articles/article_1/publications/x?kind=article',
    ) as never, { params: Promise.resolve({ id: 'article_1' }) });
    expect(mocks.getDraft).toHaveBeenCalledWith(expect.objectContaining({
      target: 'x', kind: 'article', articleId: 'article_1',
    }));

    const body = {
      kind: 'article', expectedRevision: 0, title: 'Title', markdown: 'Body', orderedAssetIds: [],
    };
    const request = new Request('https://articles.example.com/api/articles/article_1/publications/x', {
      method: 'PUT',
      headers: { origin: 'https://articles.example.com', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    await PUT(request as never, { params: Promise.resolve({ id: 'article_1' }) });
    expect(mocks.saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      target: 'x', kind: 'article', input: body,
    }));
  });

  it('accepts a valid 100,000-character Article whose JSON encoding exceeds 512,000 bytes', async () => {
    const { PUT } = await import('./route');
    const body = {
      kind: 'article', expectedRevision: 0, title: 'Large escaped article',
      markdown: '\u0000'.repeat(100_000), orderedAssetIds: [],
    };
    const encodedBody = JSON.stringify(body);
    expect(new TextEncoder().encode(encodedBody).byteLength).toBeGreaterThan(512_000);

    const response = await PUT(new Request(
      'https://articles.example.com/api/articles/article_1/publications/x',
      {
        method: 'PUT',
        headers: { origin: 'https://articles.example.com', 'content-type': 'application/json' },
        body: encodedBody,
      },
    ) as never, { params: Promise.resolve({ id: 'article_1' }) });

    expect(response.status).toBe(200);
    expect(mocks.saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      target: 'x', kind: 'article', input: body,
    }));
  });
});
