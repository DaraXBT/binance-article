import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createBatchMock, getMock, contextMock } = vi.hoisted(() => ({
  createBatchMock: vi.fn(),
  getMock: vi.fn(),
  contextMock: vi.fn(),
}));

vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: contextMock }));

import { startWorkflow } from './workflow-client';

describe('Cloudflare Workflow client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createBatchMock.mockResolvedValue([{ id: 'job_1' }]);
    getMock.mockResolvedValue({ id: 'job_1' });
    contextMock.mockReturnValue({
      env: { ARTICLE_JOBS: { createBatch: createBatchMock, get: getMock } },
    });
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

  it('recovers a duplicate deterministic workflow instance after an ambiguous retry', async () => {
    createBatchMock.mockRejectedValueOnce(new Error('instance with id already exists'));

    await expect(startWorkflow({ jobId: 'job_1', kind: 'generate' })).resolves.toEqual({
      runId: 'job_1',
    });
    expect(getMock).toHaveBeenCalledWith('job_1');
  });

  it('preserves the creation failure when no deterministic instance can be recovered', async () => {
    const createError = new Error('workflow service unavailable');
    createBatchMock.mockRejectedValueOnce(createError);
    getMock.mockRejectedValueOnce(new Error('instance not found'));

    await expect(startWorkflow({ jobId: 'job_1', kind: 'generate' })).rejects.toBe(createError);
  });

  it('rejects malformed payloads and missing bindings before reporting success', async () => {
    await expect(startWorkflow({ jobId: '', kind: 'generate' })).rejects.toThrow();
    expect(createBatchMock).not.toHaveBeenCalled();

    contextMock.mockReturnValue({ env: {} });
    await expect(startWorkflow({ jobId: 'job_1', kind: 'generate' }))
      .rejects.toThrow(/ARTICLE_JOBS Workflow binding/i);
  });
});
