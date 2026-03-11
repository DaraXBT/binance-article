import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/server/http/errors';

const dbMock = {
  createSlide: vi.fn(),
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

describe('POST /api/articles/[id]/slides', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('appends a slide when order is omitted', async () => {
    dbMock.createSlide.mockResolvedValue({ id: 'slide-1' });

    const { POST } = await import('@/app/api/articles/[id]/slides/route');
    const response = await POST(
      new Request('http://localhost/api/articles/deck-1/slides', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Untitled Slide',
          subtitle: '',
          bullets: [],
          notes: '',
        }),
      }) as never,
      { params: Promise.resolve({ id: 'deck-1' }) }
    );

    expect(response.status).toBe(201);
    expect(dbMock.createSlide).toHaveBeenCalledWith('workspace-1', 'deck-1', {
      title: 'Untitled Slide',
      subtitle: '',
      bullets: [],
      notes: '',
    });
  });

  it('returns 404 when creating a slide in another workspace article', async () => {
    dbMock.createSlide.mockRejectedValue(new AppError({ code: 'ARTICLE_NOT_FOUND', message: 'Article not found.', status: 404 }));

    const { POST } = await import('@/app/api/articles/[id]/slides/route');
    const response = await POST(
      new Request('http://localhost/api/articles/deck-2/slides', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Untitled Slide',
          bullets: [],
        }),
      }) as never,
      { params: Promise.resolve({ id: 'deck-2' }) }
    );

    expect(response.status).toBe(404);
  });
});
