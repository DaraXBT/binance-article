import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = {
  beginGenerationRevision: vi.fn(),
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
vi.mock('@/workflows/article-jobs', () => ({
  handleArticleGenerationJob: vi.fn(),
}));

describe('POST /api/articles/[id]/generate', () => {
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
    dbMock.beginGenerationRevision.mockResolvedValue({
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

  it('returns 202 with jobId when generation is started', async () => {
    const { POST } = await import('@/app/api/articles/[id]/generate/route');
    const response = await POST(
      new Request('http://localhost/api/articles/deck-1/generate', {
        method: 'POST',
        body: JSON.stringify({
          articleContent: 'This is a sufficiently long article body for testing.',
          slideCount: 3,
          illustrationStyle: 'pixel-art',
          mode: 'text',
        }),
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
        kind: 'generate',
      })
    );
  });

  it('returns 403 when generation access is enabled but not unlocked', async () => {
    generateAccessMock.isGenerateAccessEnabled.mockReturnValue(true);
    generateAccessMock.getRequestGenerateAccessState.mockResolvedValue({
      enabled: true,
      hasAccess: false,
      invalidReason: 'missing',
      grantId: null,
    });

    const { POST } = await import('@/app/api/articles/[id]/generate/route');
    const response = await POST(
      new Request('http://localhost/api/articles/deck-1/generate', {
        method: 'POST',
        body: JSON.stringify({
          articleContent: 'This is a sufficiently long article body for testing.',
          slideCount: 3,
          illustrationStyle: 'pixel-art',
          mode: 'text',
        }),
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
