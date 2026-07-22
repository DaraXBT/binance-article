import { beforeEach, describe, expect, it, vi } from 'vitest';

const jobs = vi.hoisted(() => ({
  get: vi.fn(),
  markRunning: vi.fn(),
  appendLog: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  progress: vi.fn(),
}));

vi.mock('@/server/modules/jobs/service', () => ({
  getJobRunById: jobs.get,
  markJobRunning: jobs.markRunning,
  appendJobLog: jobs.appendLog,
  completeJobRun: jobs.complete,
  failJobRun: jobs.fail,
  markJobProgress: jobs.progress,
}));

import {
  handleArticleGenerationJob,
  handleArticleImageRetryJob,
} from './article-jobs';

function cancelledJob() {
  const now = new Date('2026-07-22T00:00:00Z');
  return {
    id: 'job_1',
    deckId: 'article_1',
    workspaceId: 'workspace_1',
    kind: 'generate' as const,
    status: 'cancelled' as const,
    progress: 0,
    logs: [],
    errorCode: 'CANCELLED_BY_USER',
    errorMessage: 'Cancelled by user.',
    articleRevisionId: 'article_1:rev:1',
    runId: 'job_1',
    payload: {},
    result: null,
    startedAt: null,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

describe('article Workflow cancellation guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobs.get.mockResolvedValue(cancelledJob());
    jobs.markRunning.mockResolvedValue(null);
  });

  it('does not generate an article after its JobRun was cancelled', async () => {
    await expect(handleArticleGenerationJob('job_1')).resolves.toBeUndefined();

    expect(jobs.markRunning).toHaveBeenCalledWith('job_1');
    expect(jobs.get).toHaveBeenCalledTimes(2);
    expect(jobs.appendLog).not.toHaveBeenCalled();
    expect(jobs.progress).not.toHaveBeenCalled();
  });

  it('does not retry article images after their JobRun was cancelled', async () => {
    await expect(handleArticleImageRetryJob('job_1')).resolves.toBeUndefined();

    expect(jobs.markRunning).toHaveBeenCalledWith('job_1');
    expect(jobs.get).toHaveBeenCalledTimes(2);
    expect(jobs.appendLog).not.toHaveBeenCalled();
    expect(jobs.progress).not.toHaveBeenCalled();
  });
});
