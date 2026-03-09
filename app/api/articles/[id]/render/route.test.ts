import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = {
  getDeckProject: vi.fn(),
};

const workspaceMock = {
  getCurrentWorkspace: vi.fn(async () => ({
    workspace: {
      id: 'workspace-1',
      accessKeyPrefix: 'dwk_test',
    },
  })),
};

const jobQueueMock = {
  createJob: vi.fn(),
  enqueueRenderJob: vi.fn(),
  addJobLog: vi.fn(),
};

const fileUtilsMock = {
  createDeckAssetDir: vi.fn(() => '/tmp/deck-1'),
};

vi.mock('@/lib/db', () => dbMock);
vi.mock('@/lib/workspace', () => workspaceMock);
vi.mock('@/lib/job-queue', () => jobQueueMock);
vi.mock('@/lib/file-utils', () => fileUtilsMock);
vi.mock('@/lib/render-engine', () => ({
  renderDeck: vi.fn(),
}));

describe('POST /api/articles/[id]/render', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when the article is outside the current workspace', async () => {
    dbMock.getDeckProject.mockResolvedValue(null);

    const { POST } = await import('@/app/api/articles/[id]/render/route');
    const response = await POST(
      new Request('http://localhost/api/articles/deck-1/render', {
        method: 'POST',
      }) as never,
      { params: Promise.resolve({ id: 'deck-1' }) }
    );

    expect(response.status).toBe(404);
    expect(jobQueueMock.createJob).not.toHaveBeenCalled();
  });
});
