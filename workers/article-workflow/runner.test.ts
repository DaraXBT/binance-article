import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = vi.hoisted(() => ({
  handleArticleGenerationJob: vi.fn(),
  handleArticleImageRetryJob: vi.fn(),
}));

vi.mock('@/workflows/article-jobs', () => handlers);

import { dispatchArticleWorkflowJob, parseArticleWorkflowPayload } from './runner';

const baseEnvironment = {
  DATABASE_URL: 'postgresql://test',
  GEMINI_API_KEY: 'platform-key',
  AI_CREDENTIAL_KEYRING: '{"v1":"key"}',
  AI_CREDENTIAL_ACTIVE_KEY_ID: 'v1',
};

describe('article Workflow dispatcher', () => {
  beforeEach(() => vi.clearAllMocks());

  it('validates the persisted job payload and dispatches generation', async () => {
    const payload = parseArticleWorkflowPayload({ jobId: 'job_1', kind: 'generate' });
    await dispatchArticleWorkflowJob(payload, baseEnvironment);
    expect(handlers.handleArticleGenerationJob).toHaveBeenCalledWith('job_1', baseEnvironment, {});
    expect(handlers.handleArticleImageRetryJob).not.toHaveBeenCalled();
  });

  it('dispatches image retries and rejects unknown kinds without executing handlers', async () => {
    await dispatchArticleWorkflowJob({ jobId: 'job_2', kind: 'generate_images' }, baseEnvironment);
    expect(handlers.handleArticleImageRetryJob).toHaveBeenCalledWith('job_2', baseEnvironment, {});

    expect(() => parseArticleWorkflowPayload({ jobId: 'job_3', kind: 'render' })).toThrow();
    expect(() => parseArticleWorkflowPayload({ jobId: '', kind: 'generate' })).toThrow();
    for (const extra of [
      { apiKey: 'must-never-enter-events' },
      { credentialId: 'credential_1' },
      { workspaceId: 'workspace_1' },
      { source: 'workspace' },
    ]) {
      expect(() => parseArticleWorkflowPayload({
        jobId: 'job_3', kind: 'generate', ...extra,
      })).toThrow();
    }
  });

  it('passes the same provider environment to generation and image retries', async () => {
    const environment = { ...baseEnvironment };
    const runtime = { assetBucket: {} as never };

    await dispatchArticleWorkflowJob(
      { jobId: 'job_generate', kind: 'generate' },
      environment,
      runtime,
    );
    await dispatchArticleWorkflowJob(
      { jobId: 'job_images', kind: 'generate_images' },
      environment,
      runtime,
    );

    expect(handlers.handleArticleGenerationJob).toHaveBeenCalledWith(
      'job_generate',
      environment,
      runtime,
    );
    expect(handlers.handleArticleImageRetryJob).toHaveBeenCalledWith(
      'job_images',
      environment,
      runtime,
    );
  });
});
