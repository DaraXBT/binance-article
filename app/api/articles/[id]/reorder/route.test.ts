import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/server/http/errors';

const dbMock = {
  reorderSlides: vi.fn(),
};

const workspaceMock = {
  getCurrentWorkspace: vi.fn(async () => ({
    workspace: {
      id: 'workspace-1',
      accessKeyPrefix: 'dwk_test',
    },
  })),
};
const articleAuthorizationMock = {
  authorizeArticleRequest: vi.fn(async () => ({ workspaceId: 'workspace-1' })),
};

vi.mock('@/lib/db', () => dbMock);
vi.mock('@/lib/workspace', () => workspaceMock);
vi.mock('@/server/auth/article-authorization', () => articleAuthorizationMock);

describe('POST /api/articles/[id]/reorder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when reordering slides outside the current workspace', async () => {
    dbMock.reorderSlides.mockRejectedValue(new AppError({ code: 'ARTICLE_NOT_FOUND', message: 'Article not found.', status: 404 }));

    const { POST } = await import('@/app/api/articles/[id]/reorder/route');
    const response = await POST(
      new Request('http://localhost/api/articles/deck-1/reorder', {
        method: 'POST',
        body: JSON.stringify({
          slideOrder: [
            { id: 'slide-1', order: 0 },
            { id: 'slide-2', order: 1 },
          ],
        }),
      }) as never,
      { params: Promise.resolve({ id: 'deck-1' }) }
    );

    expect(response.status).toBe(404);
    expect(dbMock.reorderSlides).toHaveBeenCalledWith('workspace-1', 'deck-1', [
      { id: 'slide-1', order: 0 },
      { id: 'slide-2', order: 1 },
    ]);
  });
});
