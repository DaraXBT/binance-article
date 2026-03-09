import { beforeEach, describe, expect, it, vi } from 'vitest';

const jobQueueMock = {
  getJob: vi.fn(),
};

const workspaceMock = {
  getCurrentWorkspace: vi.fn(async () => ({
    workspace: {
      id: 'workspace-1',
      accessKeyPrefix: 'dwk_test',
    },
  })),
};

vi.mock('@/lib/job-queue', () => jobQueueMock);
vi.mock('@/lib/workspace', () => workspaceMock);

describe('GET /api/jobs/[jobId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 for jobs from another workspace', async () => {
    jobQueueMock.getJob.mockReturnValue({
      id: 'job-1',
      deckId: 'deck-1',
      workspaceId: 'workspace-2',
      status: 'running',
      progress: 50,
      logs: [],
      startedAt: null,
      completedAt: null,
      error: null,
    });

    const { GET } = await import('@/app/api/jobs/[jobId]/route');
    const response = await GET(
      new Request('http://localhost/api/jobs/job-1') as never,
      { params: Promise.resolve({ jobId: 'job-1' }) }
    );

    expect(response.status).toBe(404);
  });

  it('returns the job payload inside the current workspace', async () => {
    jobQueueMock.getJob.mockReturnValue({
      id: 'job-2',
      deckId: 'deck-1',
      workspaceId: 'workspace-1',
      status: 'completed',
      progress: 100,
      logs: [],
      startedAt: '2026-03-09T00:00:00.000Z',
      completedAt: '2026-03-09T00:01:00.000Z',
      error: null,
    });

    const { GET } = await import('@/app/api/jobs/[jobId]/route');
    const response = await GET(
      new Request('http://localhost/api/jobs/job-2') as never,
      { params: Promise.resolve({ jobId: 'job-2' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: 'job-2',
      deckId: 'deck-1',
      status: 'completed',
      progress: 100,
    });
  });
});
