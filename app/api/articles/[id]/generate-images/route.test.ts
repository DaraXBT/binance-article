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

const jobServiceMock = {
  createJobRun: vi.fn(),
  attachWorkflowRunId: vi.fn(),
};

const workflowClientMock = {
  startWorkflow: vi.fn(),
};

vi.mock('@/lib/db', () => dbMock);
vi.mock('@/server/modules/workspace/service', () => workspaceMock);
vi.mock('@/server/modules/jobs/service', () => jobServiceMock);
vi.mock('@/server/integrations/workflow-client', () => workflowClientMock);
vi.mock('@/workflows/article-jobs', () => ({
  handleArticleImageRetryJob: vi.fn(),
}));

describe('POST /api/articles/[id]/generate-images', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
