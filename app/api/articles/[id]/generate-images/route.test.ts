import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = {
  getCurrentRevisionContext: vi.fn(),
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
  authorizeArticleRequest: vi.fn(async () => ({
    actor: { id: 'user-1', sessionId: 'session-1' },
    database: { db: true },
    workspaceId: 'workspace-1',
  })),
};

const jobServiceMock = {
  createJobRun: vi.fn(),
  attachWorkflowRunId: vi.fn(),
};

const workflowClientMock = {
  startWorkflow: vi.fn(),
};

const rateLimitMock = {
  consumeAtomicRateLimit: vi.fn(async () => ({
    allowed: true,
    remaining: 9,
    resetAt: new Date(Date.now() + 60_000),
  })),
};

const generateAccessMock = {
  isGenerateAccessEnabled: vi.fn<() => boolean>(() => false),
  getRequestGenerateAccessState: vi.fn<
    () => Promise<{
      enabled: boolean;
      hasAccess: boolean;
      invalidReason: string | null;
      grantId: string | null;
    }>
  >(async () => ({
    enabled: false,
    hasAccess: true,
    invalidReason: null,
    grantId: null,
  })),
};

vi.mock('@/lib/db', () => dbMock);
vi.mock('@/lib/generate-access', () => generateAccessMock);
vi.mock('@/server/modules/workspace/service', () => workspaceMock);
vi.mock('@/server/auth/article-authorization', () => articleAuthorizationMock);
vi.mock('@/server/modules/jobs/service', () => jobServiceMock);
vi.mock('@/server/integrations/workflow-client', () => workflowClientMock);
vi.mock('@/server/http/atomic-rate-limit', () => rateLimitMock);

describe('POST /api/articles/[id]/generate-images', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateAccessMock.isGenerateAccessEnabled.mockReturnValue(false);
    generateAccessMock.getRequestGenerateAccessState.mockResolvedValue({
      enabled: false,
      hasAccess: true,
      invalidReason: null,
      grantId: null,
    });
    rateLimitMock.consumeAtomicRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 9,
      resetAt: new Date(Date.now() + 60_000),
    });
    dbMock.getCurrentRevisionContext.mockResolvedValue({
      deck: { id: 'deck-1' },
      revision: 1,
      articleRevisionId: 'deck-1:rev:1',
    });
    jobServiceMock.createJobRun.mockResolvedValue({
      id: 'job-1',
      status: 'queued',
    });
    workflowClientMock.startWorkflow.mockResolvedValue({ runId: 'run-1' });
  });

  it('returns 202 with jobId when image generation is started', async () => {
    const { POST } = await import('@/app/api/articles/[id]/generate-images/route');
    const response = await POST(
      new Request('http://localhost/api/articles/deck-1/generate-images', {
        method: 'POST',
        body: JSON.stringify({ illustrationStyle: 'pixel-art' }),
      }) as never,
      { params: Promise.resolve({ id: 'deck-1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toEqual({
      jobId: 'job-1',
      status: 'queued',
      articleRevisionId: 'deck-1:rev:1',
    });
    expect(jobServiceMock.createJobRun).toHaveBeenCalledWith(
      expect.objectContaining({
        deckId: 'deck-1',
        workspaceId: 'workspace-1',
        kind: 'generate_images',
      })
    );
    expect(workflowClientMock.startWorkflow).toHaveBeenCalledWith({
      jobId: 'job-1', kind: 'generate_images',
    });
    expect(jobServiceMock.attachWorkflowRunId).toHaveBeenCalledWith('job-1', 'run-1');
  });

  it('passes failed mode through to the job payload', async () => {
    const { POST } = await import('@/app/api/articles/[id]/generate-images/route');
    await POST(
      new Request('http://localhost/api/articles/deck-1/generate-images', {
        method: 'POST',
        body: JSON.stringify({ illustrationStyle: 'pixel-art', mode: 'failed' }),
      }) as never,
      { params: Promise.resolve({ id: 'deck-1' }) }
    );

    expect(jobServiceMock.createJobRun).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          mode: 'failed',
        }),
      })
    );
  });

  it('returns error when article is not found', async () => {
    dbMock.getCurrentRevisionContext.mockRejectedValue(
      new Error('Article not found.')
    );

    const { POST } = await import('@/app/api/articles/[id]/generate-images/route');
    const response = await POST(
      new Request('http://localhost/api/articles/deck-2/generate-images', {
        method: 'POST',
        body: JSON.stringify({ illustrationStyle: 'pixel-art' }),
      }) as never,
      { params: Promise.resolve({ id: 'deck-2' }) }
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('returns 403 when retrying images without generation access', async () => {
    generateAccessMock.isGenerateAccessEnabled.mockReturnValue(true);
    generateAccessMock.getRequestGenerateAccessState.mockResolvedValue({
      enabled: true,
      hasAccess: false,
      invalidReason: 'missing',
      grantId: null,
    });

    const { POST } = await import('@/app/api/articles/[id]/generate-images/route');
    const response = await POST(
      new Request('http://localhost/api/articles/deck-1/generate-images', {
        method: 'POST',
        body: JSON.stringify({ illustrationStyle: 'pixel-art' }),
      }) as never,
      { params: Promise.resolve({ id: 'deck-1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual(
      expect.objectContaining({
        code: 'GENERATE_ACCESS_REQUIRED',
      })
    );
    expect(jobServiceMock.createJobRun).not.toHaveBeenCalled();
  });
});
