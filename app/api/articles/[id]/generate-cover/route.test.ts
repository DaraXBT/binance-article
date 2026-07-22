import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRevision: vi.fn(),
  authorize: vi.fn(),
  createJob: vi.fn(),
  attachRun: vi.fn(),
  startWorkflow: vi.fn(),
  rateLimit: vi.fn(),
  accessEnabled: vi.fn(),
  accessState: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ getCurrentRevisionContext: mocks.getRevision }));
vi.mock('@/server/auth/article-authorization', () => ({ authorizeArticleRequest: mocks.authorize }));
vi.mock('@/server/modules/jobs/service', () => ({
  createJobRun: mocks.createJob,
  attachWorkflowRunId: mocks.attachRun,
}));
vi.mock('@/server/integrations/workflow-client', () => ({ startWorkflow: mocks.startWorkflow }));
vi.mock('@/server/http/atomic-rate-limit', () => ({ consumeAtomicRateLimit: mocks.rateLimit }));
vi.mock('@/lib/generate-access', () => ({
  isGenerateAccessEnabled: mocks.accessEnabled,
  getRequestGenerateAccessState: mocks.accessState,
}));

describe('POST /api/articles/[id]/generate-cover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({
      actor: { id: 'user-1', sessionId: 'session-1' },
      database: { db: true },
      workspaceId: 'workspace-1',
    });
    mocks.getRevision.mockResolvedValue({
      deck: { id: 'deck-1', illustrationStyle: 'binance-master' },
      revision: 3,
      articleRevisionId: 'deck-1:rev:3',
    });
    mocks.createJob.mockResolvedValue({ id: 'job-1', status: 'queued' });
    mocks.startWorkflow.mockResolvedValue({ runId: 'run-1' });
    mocks.rateLimit.mockResolvedValue({
      allowed: true,
      resetAt: new Date('2026-07-22T01:00:00.000Z'),
    });
    mocks.accessEnabled.mockReturnValue(false);
    mocks.accessState.mockResolvedValue({ hasAccess: true, invalidReason: null });
  });

  it('queues a cover-scoped image workflow for the current article revision', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      new Request('http://localhost/api/articles/deck-1/generate-cover', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }) as never,
      { params: Promise.resolve({ id: 'deck-1' }) },
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      jobId: 'job-1',
      status: 'queued',
      articleRevisionId: 'deck-1:rev:3',
    });
    expect(mocks.createJob).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'generate_images',
      articleRevisionId: 'deck-1:rev:3',
      payload: {
        illustrationStyle: 'binance-master',
        mode: 'missing',
        scope: 'cover',
      },
    }));
    expect(mocks.startWorkflow).toHaveBeenCalledWith({
      jobId: 'job-1',
      kind: 'generate_images',
    });
    expect(mocks.attachRun).toHaveBeenCalledWith('job-1', 'run-1');
  });
});
