import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireActiveUser: vi.fn(async () => ({ id: 'user_1', sessionId: 'session_1' })),
  getRuntimeDatabase: vi.fn(() => ({ db: true })),
  requireArticleWorkspace: vi.fn(async () => 'workspace_1'),
}));

vi.mock('./authorization', () => ({ requireActiveUser: mocks.requireActiveUser }));
vi.mock('@/server/db/runtime', () => ({ getRuntimeDatabase: mocks.getRuntimeDatabase }));
vi.mock('@/server/modules/workspace/membership', () => ({
  requireArticleWorkspace: mocks.requireArticleWorkspace,
}));

import { authorizeArticleRequest } from './article-authorization';

describe('article request authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveUser.mockResolvedValue({ id: 'user_1', sessionId: 'session_1' });
    mocks.getRuntimeDatabase.mockReturnValue({ db: true });
    mocks.requireArticleWorkspace.mockResolvedValue('workspace_1');
  });

  it('returns only a verified actor, database, and exact member workspace', async () => {
    const request = new Request('https://articles.example.com/api/articles/article_1');
    await expect(authorizeArticleRequest(request, 'article_1')).resolves.toEqual({
      actor: { id: 'user_1', sessionId: 'session_1' },
      database: { db: true },
      workspaceId: 'workspace_1',
    });
    expect(mocks.requireActiveUser).toHaveBeenCalledWith(request);
    expect(mocks.requireArticleWorkspace).toHaveBeenCalledWith(
      { db: true }, 'user_1', 'article_1',
    );
  });

  it('stops before tenant lookup when authentication fails', async () => {
    const { AppError } = await import('@/server/http/errors');
    mocks.requireActiveUser.mockRejectedValueOnce(new AppError({
      code: 'AUTH_REQUIRED', message: 'Authentication is required.', status: 401,
    }));
    await expect(authorizeArticleRequest(
      new Request('https://articles.example.com/api/articles/article_1'),
      'article_1',
    )).rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 401 });
    expect(mocks.getRuntimeDatabase).not.toHaveBeenCalled();
    expect(mocks.requireArticleWorkspace).not.toHaveBeenCalled();
  });
});
