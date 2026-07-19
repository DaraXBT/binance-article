import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = vi.hoisted(() => ({
  handleArticleGenerationJob: vi.fn(),
  handleArticleImageRetryJob: vi.fn(),
}));

vi.mock('@/workflows/article-jobs', () => handlers);

import { dispatchArticleWorkflowJob, parseArticleWorkflowPayload } from './runner';

describe('article Workflow dispatcher', () => {
  beforeEach(() => vi.clearAllMocks());

  it('validates the persisted job payload and dispatches generation', async () => {
    const payload = parseArticleWorkflowPayload({ jobId: 'job_1', kind: 'generate' });
    await dispatchArticleWorkflowJob(payload);
    expect(handlers.handleArticleGenerationJob).toHaveBeenCalledWith('job_1');
    expect(handlers.handleArticleImageRetryJob).not.toHaveBeenCalled();
  });

  it('dispatches image retries and rejects unknown kinds without executing handlers', async () => {
    await dispatchArticleWorkflowJob({ jobId: 'job_2', kind: 'generate_images' });
    expect(handlers.handleArticleImageRetryJob).toHaveBeenCalledWith('job_2');

    expect(() => parseArticleWorkflowPayload({ jobId: 'job_3', kind: 'render' })).toThrow();
    expect(() => parseArticleWorkflowPayload({ jobId: '', kind: 'generate' })).toThrow();
  });
});
