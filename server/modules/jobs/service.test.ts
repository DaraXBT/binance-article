import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { repositoryMock } = vi.hoisted(() => ({
  repositoryMock: {
    create: vi.fn(),
    attachWorkflowRunId: vi.fn(),
    findForWorkspace: vi.fn(),
    findById: vi.fn(),
    createGenerationIdempotently: vi.fn(),
    findLatestForDeck: vi.fn(),
    appendLog: vi.fn(),
    markRunning: vi.fn(),
    markProgress: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
  },
}));

vi.mock('./repository', () => ({
  createJobRepository: vi.fn(() => repositoryMock),
}));
vi.mock('@/server/db/runtime', () => ({
  getRuntimeDatabase: vi.fn(() => ({ database: true })),
}));
import {
  appendJobLog,
  attachWorkflowRunId,
  beginIdempotentGeneration,
  findIdempotentGeneration,
  completeJobRun,
  createJobRun,
  failJobRun,
  getJobRun,
  getJobRunById,
  getLatestDeckJob,
  markJobProgress,
  markJobRunning,
  readJobLogs,
  serializeJobRun,
} from './service';

function fakeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job_1',
    deckId: 'deck_1',
    workspaceId: 'workspace_1',
    kind: 'generate' as const,
    status: 'queued' as const,
    progress: 0,
    logs: [],
    errorCode: null,
    errorMessage: null,
    articleRevisionId: 'deck_1:rev:1',
    runId: null,
    payload: null,
    result: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date('2026-07-19T00:00:00.000Z'),
    updatedAt: new Date('2026-07-19T00:00:00.000Z'),
    ...overrides,
  };
}

describe('Worker-safe job service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-19T12:00:00.000Z'));
    repositoryMock.create.mockResolvedValue(fakeJob());
    repositoryMock.attachWorkflowRunId.mockResolvedValue(fakeJob());
    repositoryMock.findForWorkspace.mockResolvedValue(fakeJob());
    repositoryMock.findById.mockResolvedValue(fakeJob());
    repositoryMock.createGenerationIdempotently.mockResolvedValue({
      job: fakeJob(), replayed: false,
    });
    repositoryMock.findLatestForDeck.mockResolvedValue(fakeJob());
    repositoryMock.appendLog.mockResolvedValue(fakeJob());
    repositoryMock.markRunning.mockResolvedValue(fakeJob({ status: 'running' }));
    repositoryMock.markProgress.mockResolvedValue(fakeJob());
    repositoryMock.complete.mockResolvedValue(fakeJob({ status: 'completed' }));
    repositoryMock.fail.mockResolvedValue(fakeJob({ status: 'failed' }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a job with an explicit UUID, timestamps, queued state, and empty logs', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');

    await createJobRun({
      deckId: 'deck_1',
      workspaceId: 'workspace_1',
      kind: 'generate',
      articleRevisionId: 'deck_1:rev:1',
      payload: { mode: 'text' },
    });

    expect(repositoryMock.create).toHaveBeenCalledWith({
      id: '00000000-0000-4000-8000-000000000001',
      deckId: 'deck_1',
      workspaceId: 'workspace_1',
      kind: 'generate',
      status: 'queued',
      progress: 0,
      articleRevisionId: 'deck_1:rev:1',
      payload: { mode: 'text' },
      logs: [],
      now: new Date('2026-07-19T12:00:00.000Z'),
    });
  });

  it('attaches a workflow run id idempotently through the repository', async () => {
    await attachWorkflowRunId('job_1', 'run_1');
    expect(repositoryMock.attachWorkflowRunId).toHaveBeenCalledWith({
      jobId: 'job_1', runId: 'run_1', now: new Date('2026-07-19T12:00:00.000Z'),
    });
  });

  it('keeps public lookup tenant-scoped and latest lookup deterministic', async () => {
    await getJobRun('job_1', 'workspace_1');
    await getLatestDeckJob('deck_1', 'workspace_1');
    await getJobRunById('job_1');

    expect(repositoryMock.findForWorkspace).toHaveBeenCalledWith('job_1', 'workspace_1');
    expect(repositoryMock.findLatestForDeck).toHaveBeenCalledWith('deck_1', 'workspace_1');
    expect(repositoryMock.findById).toHaveBeenCalledWith('job_1');
  });

  it('matches a replayed JSONB payload regardless of database key order', async () => {
    repositoryMock.findById.mockResolvedValue(fakeJob({
      payload: {
        mode: 'prompt',
        illustrationStyle: 'lab-notes',
        slideCount: 5,
        articleContent: 'A durable prompt',
      },
    }));

    await expect(findIdempotentGeneration({
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      deckId: 'deck_1',
      workspaceId: 'workspace_1',
      payload: {
        articleContent: 'A durable prompt',
        slideCount: 5,
        illustrationStyle: 'lab-notes',
        mode: 'prompt',
      },
    })).resolves.toMatchObject({ id: 'job_1' });
  });

  it('passes the atomic rate-limit policy into same-key generation creation', async () => {
    repositoryMock.createGenerationIdempotently.mockResolvedValueOnce({
      job: null,
      replayed: false,
      rateLimited: true,
      resetAt: new Date('2026-07-19T13:00:00.000Z'),
    });

    await expect(beginIdempotentGeneration({
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      deckId: 'deck_1',
      workspaceId: 'workspace_1',
      payload: { mode: 'prompt' },
      rateLimit: { key: 'generate:user_1', limit: 10, windowMs: 3_600_000 },
    })).resolves.toMatchObject({ rateLimited: true, job: null });

    expect(repositoryMock.createGenerationIdempotently).toHaveBeenCalledWith({
      id: '11111111-1111-4111-8111-111111111111',
      deckId: 'deck_1',
      workspaceId: 'workspace_1',
      payload: { mode: 'prompt' },
      now: new Date('2026-07-19T12:00:00.000Z'),
      rateLimit: { key: 'generate:user_1', limit: 10, windowMs: 3_600_000 },
    });
  });

  it('appends one structured log atomically', async () => {
    await appendJobLog('job_1', 'Started', 'success', { step: 1 });

    expect(repositoryMock.appendLog).toHaveBeenCalledWith({
      jobId: 'job_1',
      log: {
        timestamp: '2026-07-19T12:00:00.000Z',
        message: 'Started',
        level: 'success',
        meta: { step: 1 },
      },
      now: new Date('2026-07-19T12:00:00.000Z'),
    });
  });

  it('marks running through a guarded repository transition', async () => {
    await markJobRunning('job_1');
    expect(repositoryMock.markRunning).toHaveBeenCalledWith({
      jobId: 'job_1', now: new Date('2026-07-19T12:00:00.000Z'),
    });
  });

  it('clamps progress and combines the optional log with the same update', async () => {
    await markJobProgress('job_1', 150.4, 'Generated slides.', { count: 4 });

    expect(repositoryMock.markProgress).toHaveBeenCalledWith({
      jobId: 'job_1',
      progress: 100,
      log: {
        timestamp: '2026-07-19T12:00:00.000Z',
        message: 'Generated slides.',
        level: 'info',
        meta: { count: 4 },
      },
      now: new Date('2026-07-19T12:00:00.000Z'),
    });
  });

  it('completes status, result, progress, and success log atomically', async () => {
    await completeJobRun('job_1', { slideCount: 5 });

    expect(repositoryMock.complete).toHaveBeenCalledWith({
      jobId: 'job_1',
      result: { slideCount: 5 },
      log: {
        timestamp: '2026-07-19T12:00:00.000Z',
        message: 'Job completed successfully.',
        level: 'success',
      },
      now: new Date('2026-07-19T12:00:00.000Z'),
    });
    expect(repositoryMock.appendLog).not.toHaveBeenCalled();
  });

  it('fails or cancels with a terminal error log in one transition', async () => {
    await failJobRun('job_1', 'CANCELLED', 'User cancelled', 'cancelled', { safe: true });

    expect(repositoryMock.fail).toHaveBeenCalledWith({
      jobId: 'job_1',
      code: 'CANCELLED',
      message: 'User cancelled',
      status: 'cancelled',
      result: { safe: true },
      log: {
        timestamp: '2026-07-19T12:00:00.000Z',
        message: 'User cancelled',
        level: 'error',
      },
      now: new Date('2026-07-19T12:00:00.000Z'),
    });
  });

  it('sanitizes malformed stored logs during serialization', () => {
    const logs = readJobLogs([
      { timestamp: '2026-07-19T00:00:00.000Z', message: 'ok', level: 'success' },
      { timestamp: 1, message: 'bad' },
      null,
    ]);
    expect(logs).toEqual([
      { timestamp: '2026-07-19T00:00:00.000Z', message: 'ok', level: 'success', meta: undefined },
    ]);
    expect(serializeJobRun(fakeJob({ logs })).logs).toEqual(logs);
  });
});
