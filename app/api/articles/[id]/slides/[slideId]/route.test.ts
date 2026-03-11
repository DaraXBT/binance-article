import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/server/http/errors';

const dbMock = {
  updateSlide: vi.fn(),
  deleteSlide: vi.fn(),
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

describe('PATCH/DELETE /api/articles/[id]/slides/[slideId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when updating a slide outside the current workspace', async () => {
    dbMock.updateSlide.mockRejectedValue(new AppError({ code: 'SLIDE_NOT_FOUND', message: 'Slide not found.', status: 404 }));

    const { PATCH } = await import('@/app/api/articles/[id]/slides/[slideId]/route');
    const response = await PATCH(
      new Request('http://localhost/api/articles/deck-1/slides/slide-1', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated title' }),
      }) as never,
      { params: Promise.resolve({ id: 'deck-1', slideId: 'slide-1' }) }
    );

    expect(response.status).toBe(404);
  });

  it('scopes slide deletion to the current workspace article', async () => {
    dbMock.deleteSlide.mockResolvedValue(undefined);

    const { DELETE } = await import('@/app/api/articles/[id]/slides/[slideId]/route');
    const response = await DELETE(
      new Request('http://localhost/api/articles/deck-1/slides/slide-1', {
        method: 'DELETE',
      }) as never,
      { params: Promise.resolve({ id: 'deck-1', slideId: 'slide-1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(dbMock.deleteSlide).toHaveBeenCalledWith('workspace-1', 'deck-1', 'slide-1');
  });
});
