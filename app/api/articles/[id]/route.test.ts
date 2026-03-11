import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/server/http/errors';

const dbMock = {
  getDeckWithAssets: vi.fn(),
  updateDeckProject: vi.fn(),
  deleteDeckProject: vi.fn(),
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
vi.mock('@/server/modules/workspace/service', () => workspaceMock);

describe('GET/PATCH/DELETE /api/articles/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when the article is outside the current workspace', async () => {
    dbMock.getDeckWithAssets.mockResolvedValue(null);

    const { GET } = await import('@/app/api/articles/[id]/route');
    const response = await GET(
      new Request('http://localhost/api/articles/deck-1') as never,
      { params: Promise.resolve({ id: 'deck-1' }) }
    );

    expect(response.status).toBe(404);
    expect(dbMock.getDeckWithAssets).toHaveBeenCalledWith('deck-1', 'workspace-1');
  });

  it('trims the updated article title before saving it', async () => {
    dbMock.updateDeckProject.mockResolvedValue({ id: 'deck-1', title: 'Updated title' });

    const { PATCH } = await import('@/app/api/articles/[id]/route');
    const response = await PATCH(
      new Request('http://localhost/api/articles/deck-1', {
        method: 'PATCH',
        body: JSON.stringify({ title: '  Updated title  ' }),
      }) as never,
      { params: Promise.resolve({ id: 'deck-1' }) }
    );

    expect(response.status).toBe(200);
    expect(dbMock.updateDeckProject).toHaveBeenCalledWith(
      'deck-1',
      'workspace-1',
      expect.objectContaining({ title: 'Updated title' })
    );
  });

  it('rejects whitespace-only article title updates', async () => {
    dbMock.updateDeckProject.mockResolvedValue({ id: 'deck-1' });

    const { PATCH } = await import('@/app/api/articles/[id]/route');
    const response = await PATCH(
      new Request('http://localhost/api/articles/deck-1', {
        method: 'PATCH',
        body: JSON.stringify({ title: '   ' }),
      }) as never,
      { params: Promise.resolve({ id: 'deck-1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Title is required', code: 'VALIDATION_ERROR' });
    expect(dbMock.updateDeckProject).not.toHaveBeenCalled();
  });

  it('returns 404 on update when the article is not owned by the workspace', async () => {
    dbMock.updateDeckProject.mockRejectedValue(new AppError({ code: 'ARTICLE_NOT_FOUND', message: 'Article not found.', status: 404 }));

    const { PATCH } = await import('@/app/api/articles/[id]/route');
    const response = await PATCH(
      new Request('http://localhost/api/articles/deck-1', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated' }),
      }) as never,
      { params: Promise.resolve({ id: 'deck-1' }) }
    );

    expect(response.status).toBe(404);
    expect(dbMock.updateDeckProject).toHaveBeenCalledWith(
      'deck-1',
      'workspace-1',
      expect.objectContaining({ title: 'Updated' })
    );
  });

  it('deletes the article inside the current workspace', async () => {
    dbMock.deleteDeckProject.mockResolvedValue({ id: 'deck-1' });

    const { DELETE } = await import('@/app/api/articles/[id]/route');
    const response = await DELETE(
      new Request('http://localhost/api/articles/deck-1', {
        method: 'DELETE',
      }) as never,
      { params: Promise.resolve({ id: 'deck-1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(dbMock.deleteDeckProject).toHaveBeenCalledWith('deck-1', 'workspace-1');
  });
});
