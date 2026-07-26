import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = {
  beginGenerationRevision: vi.fn(),
  markDeckStatus: vi.fn(async () => null),
  parseRevisionNumber: vi.fn((revisionId: string) => {
    const match = /^.+:rev:(0|[1-9][0-9]*)$/.exec(revisionId);
    return match ? Number(match[1]) : 0;
  }),
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
  failJobRun: vi.fn(async () => null),
  findIdempotentGeneration: vi.fn(),
  beginIdempotentGeneration: vi.fn(),
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
vi.mock('@/server/auth/article-authorization', () => articleAuthorizationMock);
vi.mock('@/server/modules/jobs/service', () => jobServiceMock);
vi.mock('@/server/integrations/workflow-client', () => workflowClientMock);
vi.mock('@/server/http/atomic-rate-limit', () => rateLimitMock);

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
    jobServiceMock.findIdempotentGeneration.mockResolvedValue(null);
    jobServiceMock.beginIdempotentGeneration.mockResolvedValue({
      job: {
        id: '11111111-1111-4111-8111-111111111111',
        status: 'queued',
        runId: null,
        articleRevisionId: 'deck-1:rev:1',
      },
      replayed: false,
    });
    workflowClientMock.startWorkflow.mockResolvedValue({ runId: 'run-1' });
    jobServiceMock.failJobRun.mockResolvedValue(null);
    dbMock.markDeckStatus.mockResolvedValue(null);
  });

  it('compensates the job and deck when the workflow cannot be started', async () => {
    workflowClientMock.startWorkflow.mockRejectedValue(new Error('binding unavailable'));

    const { POST } = await import('@/app/api/articles/[id]/generate/route');
    const response = await POST(
      new Request('http://localhost/api/articles/deck-1/generate', {
        method: 'POST',
        body: JSON.stringify({
          articleContent: 'A long enough article body for generation.',
          slideCount: 1,
          mode: 'text',
        }),
      }) as never,
      { params: Promise.resolve({ id: 'deck-1' }) },
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(jobServiceMock.failJobRun).toHaveBeenCalledWith(
      'job-1',
      'WORKFLOW_START_FAILED',
      expect.any(String),
    );
    expect(dbMock.markDeckStatus).toHaveBeenCalledWith(
      'deck-1',
      'workspace-1',
      'failed',
      { expectedGenerationRevision: 1 },
    );
    expect(jobServiceMock.attachWorkflowRunId).not.toHaveBeenCalled();
  });

  it('uses one idempotency key for the revision, job, and workflow handoff', async () => {
    const { POST } = await import('@/app/api/articles/[id]/generate/route');
    const idempotencyKey = '11111111-1111-4111-8111-111111111111';
    const response = await POST(
      new Request('http://localhost/api/articles/deck-1/generate', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          articleContent: 'This is a sufficiently long article body for testing.',
          slideCount: 3,
          illustrationStyle: 'pixel-art',
          mode: 'text',
        }),
      }) as never,
      { params: Promise.resolve({ id: 'deck-1' }) },
    );

    expect(response.status).toBe(202);
    expect(jobServiceMock.beginIdempotentGeneration).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey,
      deckId: 'deck-1',
      workspaceId: 'workspace-1',
      payload: expect.objectContaining({ slideCount: 3 }),
      rateLimit: {
        key: 'generate:user-1',
        limit: 10,
        windowMs: 60 * 60 * 1_000,
      },
    }));
    expect(rateLimitMock.consumeAtomicRateLimit).not.toHaveBeenCalled();
    expect(dbMock.beginGenerationRevision).not.toHaveBeenCalled();
    expect(jobServiceMock.createJobRun).not.toHaveBeenCalled();
    expect(workflowClientMock.startWorkflow).toHaveBeenCalledWith({
      jobId: idempotencyKey,
      kind: 'generate',
    });
  });

  it('returns an authenticated replay without consuming another rate-limit slot', async () => {
    jobServiceMock.findIdempotentGeneration.mockResolvedValueOnce({
      id: '11111111-1111-4111-8111-111111111111',
      status: 'queued',
      runId: 'run-existing',
      articleRevisionId: 'deck-1:rev:1',
    });
    const { POST } = await import('@/app/api/articles/[id]/generate/route');
    const response = await POST(
      new Request('http://localhost/api/articles/deck-1/generate', {
        method: 'POST',
        headers: { 'Idempotency-Key': '11111111-1111-4111-8111-111111111111' },
        body: JSON.stringify({
          articleContent: 'This is a sufficiently long article body for testing.',
          slideCount: 3,
          illustrationStyle: 'pixel-art',
          mode: 'text',
        }),
      }) as never,
      { params: Promise.resolve({ id: 'deck-1' }) },
    );

    expect(response.status).toBe(202);
    expect(rateLimitMock.consumeAtomicRateLimit).not.toHaveBeenCalled();
    expect(jobServiceMock.beginIdempotentGeneration).not.toHaveBeenCalled();
    expect(workflowClientMock.startWorkflow).not.toHaveBeenCalled();
  });

  it('returns the atomic idempotent rate-limit result without creating a job', async () => {
    jobServiceMock.beginIdempotentGeneration.mockResolvedValueOnce({
      job: null,
      replayed: false,
      rateLimited: true,
      resetAt: new Date(Date.now() + 60_000),
    });
    const { POST } = await import('@/app/api/articles/[id]/generate/route');
    const response = await POST(
      new Request('http://localhost/api/articles/deck-1/generate', {
        method: 'POST',
        headers: { 'Idempotency-Key': '11111111-1111-4111-8111-111111111111' },
        body: JSON.stringify({
          articleContent: 'This is a sufficiently long article body for testing.',
          slideCount: 3,
          illustrationStyle: 'pixel-art',
          mode: 'text',
        }),
      }) as never,
      { params: Promise.resolve({ id: 'deck-1' }) },
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ code: 'RATE_LIMITED' });
    expect(workflowClientMock.startWorkflow).not.toHaveBeenCalled();
    expect(rateLimitMock.consumeAtomicRateLimit).not.toHaveBeenCalled();
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
    expect(workflowClientMock.startWorkflow).toHaveBeenCalledWith({
      jobId: 'job-1', kind: 'generate',
    });
    expect(jobServiceMock.attachWorkflowRunId).toHaveBeenCalledWith('job-1', 'run-1');
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
