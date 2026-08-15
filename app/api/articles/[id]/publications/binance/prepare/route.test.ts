import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireActiveUser: vi.fn(async () => ({ id: 'user_1' })),
  assertAllowedOrigin: vi.fn(),
  database: { db: true },
  getRuntimeDatabase: vi.fn(),
  resolveArticleWorkspace: vi.fn(async () => 'workspace_1'),
  repository: { repository: true },
  createRepository: vi.fn(),
  prepare: vi.fn(async () => ({
    recipe: { version: 1, draftId: 'draft_1', title: 'Title' },
    recipeHash: 'a'.repeat(64),
    command: { id: 'command_1', state: 'queued' },
  })),
}));
mocks.getRuntimeDatabase.mockReturnValue(mocks.database);
mocks.createRepository.mockReturnValue(mocks.repository);

vi.mock('@/server/auth/authorization', () => ({ requireActiveUser: mocks.requireActiveUser }));
vi.mock('@/server/auth/origin', () => ({ assertAllowedOrigin: mocks.assertAllowedOrigin }));
vi.mock('@/server/db/runtime', () => ({ getRuntimeDatabase: mocks.getRuntimeDatabase }));
vi.mock('@/server/modules/workspace/membership', () => ({ resolveArticleWorkspace: mocks.resolveArticleWorkspace }));
vi.mock('@/server/modules/publications/binance/repository', () => ({
  createBinancePublicationRepository: mocks.createRepository,
}));
vi.mock('@/server/modules/publications/binance/service', () => ({
  prepareBinancePublication: mocks.prepare,
}));

describe('POST /api/articles/:id/publications/binance/prepare', () => {
  it('prepares only the authenticated member exact revision', async () => {
    const { POST } = await import('./route');
    const request = new Request(
      'https://articles.example.com/api/articles/article_1/publications/binance/prepare',
      {
        method: 'POST',
        headers: { origin: 'https://articles.example.com', 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRevision: 3 }),
      },
    );
    const response = await POST(request as never, { params: Promise.resolve({ id: 'article_1' }) });

    expect(response.status).toBe(201);
    expect(mocks.prepare).toHaveBeenCalledWith({
      repository: mocks.repository,
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
      articleId: 'article_1',
      expectedRevision: 3,
    });
    expect(await response.json()).toMatchObject({
      recipeHash: 'a'.repeat(64),
      command: { id: 'command_1', state: 'queued' },
    });
  });

  it('prepares an explicit Binance Post revision', async () => {
    const { POST } = await import('./route');
    const request = new Request(
      'https://articles.example.com/api/articles/article_1/publications/binance/prepare',
      {
        method: 'POST',
        headers: { origin: 'https://articles.example.com', 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'post', expectedRevision: 8 }),
      },
    );
    await POST(request as never, { params: Promise.resolve({ id: 'article_1' }) });
    expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'post', expectedRevision: 8,
    }));
  });
});
