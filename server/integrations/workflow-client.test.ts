import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createBatchMock, contextMock } = vi.hoisted(() => ({
  createBatchMock: vi.fn(),
  contextMock: vi.fn(),
}));

vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: contextMock }));

import { startWorkflow } from './workflow-client';

describe('Cloudflare Workflow client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createBatchMock.mockResolvedValue([{ id: 'job_1' }]);
    contextMock.mockReturnValue({ env: { ARTICLE_JOBS: { createBatch: createBatchMock } } });
  });

  it('starts an idempotent instance whose ID is the persisted job ID', async () => {
    await expect(startWorkflow({ jobId: 'job_1', kind: 'generate' })).resolves.toEqual({
      runId: 'job_1',
    });
    expect(createBatchMock).toHaveBeenCalledWith([{
      id: 'job_1', params: { jobId: 'job_1', kind: 'generate' },
    }]);
  });

  it('returns the deterministic ID when Cloudflare skips an existing instance', async () => {
    createBatchMock.mockResolvedValue([]);
    await expect(startWorkflow({ jobId: 'job_1', kind: 'generate_images' })).resolves.toEqual({
      runId: 'job_1',
    });
  });

  it('rejects malformed payloads and missing bindings before reporting success', async () => {
    await expect(startWorkflow({ jobId: '', kind: 'generate' })).rejects.toThrow();
    expect(createBatchMock).not.toHaveBeenCalled();

    contextMock.mockReturnValue({ env: {} });
    await expect(startWorkflow({ jobId: 'job_1', kind: 'generate' }))
      .rejects.toThrow(/ARTICLE_JOBS Workflow binding/i);
  });
});
