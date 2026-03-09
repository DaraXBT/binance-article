import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@/lib/db', () => dbMock);
vi.mock('@/lib/workspace', () => workspaceMock);

describe('POST /api/articles/[id]/reorder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when reordering slides outside the current workspace', async () => {
    dbMock.reorderSlides.mockRejectedValue(new Error('Deck not found'));

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
