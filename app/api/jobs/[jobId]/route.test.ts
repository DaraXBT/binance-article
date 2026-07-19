import { beforeEach, describe, expect, it, vi } from 'vitest';

const workspaceMock = {
  requireActorWorkspace: vi.fn(async () => ({ id: 'workspace-1' })),
};
const authMock = {
  requireActiveUser: vi.fn(async () => ({ id: 'user-1', sessionId: 'session-1' })),
};
const runtimeMock = { getRuntimeDatabase: vi.fn(() => ({ db: true })) };

const jobServiceMock = {
  getJobRun: vi.fn(),
  serializeJobRun: vi.fn((job: Record<string, unknown>) => job),
};

vi.mock('@/server/modules/workspace/membership', () => workspaceMock);
vi.mock('@/server/auth/authorization', () => authMock);
vi.mock('@/server/db/runtime', () => runtimeMock);
vi.mock('@/server/modules/jobs/service', () => jobServiceMock);

describe('GET /api/jobs/[jobId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.requireActiveUser.mockResolvedValue({ id: 'user-1', sessionId: 'session-1' });
    workspaceMock.requireActorWorkspace.mockResolvedValue({ id: 'workspace-1' });
  });

  it('returns 404 when the job is not found', async () => {
    jobServiceMock.getJobRun.mockResolvedValue(null);

    const { GET } = await import('@/app/api/jobs/[jobId]/route');
    const response = await GET(
      new Request('http://localhost/api/jobs/job-1') as never,
      { params: Promise.resolve({ jobId: 'job-1' }) }
    );

    expect(response.status).toBe(404);
    expect(authMock.requireActiveUser).toHaveBeenCalledOnce();
    expect(jobServiceMock.getJobRun).toHaveBeenCalledWith('job-1', 'workspace-1');
  });

  it('returns the job payload inside the current workspace', async () => {
    const mockJob = {
      id: 'job-2',
      deckId: 'deck-1',
      workspaceId: 'workspace-1',
      status: 'completed',
      progress: 100,
      logs: [],
      startedAt: '2026-03-09T00:00:00.000Z',
      completedAt: '2026-03-09T00:01:00.000Z',
      error: null,
    };
    jobServiceMock.getJobRun.mockResolvedValue(mockJob);

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

  it('authenticates before querying a job identifier', async () => {
    const { AppError } = await import('@/server/http/errors');
    authMock.requireActiveUser.mockRejectedValueOnce(new AppError({
      code: 'AUTH_REQUIRED', message: 'Authentication is required.', status: 401,
    }));
    const { GET } = await import('@/app/api/jobs/[jobId]/route');
    const response = await GET(
      new Request('https://articles.example.com/api/jobs/job-secret') as never,
      { params: Promise.resolve({ jobId: 'job-secret' }) },
    );
    expect(response.status).toBe(401);
    expect(workspaceMock.requireActorWorkspace).not.toHaveBeenCalled();
    expect(jobServiceMock.getJobRun).not.toHaveBeenCalled();
  });
});
