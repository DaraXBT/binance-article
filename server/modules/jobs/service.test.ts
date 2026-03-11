import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    jobRun: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@/server/integrations/prisma', () => ({ default: prismaMock }));

import {
  createJobRun,
  markJobRunning,
  completeJobRun,
  failJobRun,
  appendJobLog,
  readJobLogs,
  serializeJobRun,
  getJobRun,
  getJobRunById,
  getLatestDeckJob,
  attachWorkflowRunId,
  markJobProgress,
} from './service';

function fakeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    deckId: 'deck-1',
    workspaceId: 'ws-1',
    kind: 'generate' as const,
    status: 'queued' as const,
    progress: 0,
    logs: [],
    errorCode: null,
    errorMessage: null,
    articleRevisionId: 'deck-1:rev:1',
    runId: null,
    payload: null,
    result: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createJobRun', () => {
  it('creates a job with queued status and empty logs', async () => {
    const job = fakeJob();
    prismaMock.jobRun.create.mockResolvedValue(job);

    const result = await createJobRun({
      deckId: 'deck-1',
      workspaceId: 'ws-1',
      kind: 'generate',
      articleRevisionId: 'deck-1:rev:1',
    });

    expect(prismaMock.jobRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        deckId: 'deck-1',
        workspaceId: 'ws-1',
        kind: 'generate',
        status: 'queued',
        progress: 0,
        articleRevisionId: 'deck-1:rev:1',
        logs: [],
      }),
    });
    expect(result).toEqual(job);
  });
});

describe('job state transitions', () => {
  describe('queued → running → completed', () => {
    it('markJobRunning sets status to running with startedAt', async () => {
      prismaMock.jobRun.update.mockResolvedValue(fakeJob({ status: 'running' }));

      await markJobRunning('job-1');

      expect(prismaMock.jobRun.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: {
          status: 'running',
          startedAt: expect.any(Date),
        },
      });
    });

    it('completeJobRun sets status to completed with progress 100', async () => {
      prismaMock.jobRun.update.mockResolvedValue(
        fakeJob({ status: 'completed', progress: 100 })
      );
      prismaMock.jobRun.findUnique.mockResolvedValue(fakeJob({ logs: [] }));

      await completeJobRun('job-1', { slideCount: 5 });

      expect(prismaMock.jobRun.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          status: 'completed',
          progress: 100,
          result: { slideCount: 5 },
          completedAt: expect.any(Date),
        }),
      });
    });
  });

  describe('queued → running → failed', () => {
    it('failJobRun sets status to failed with error details', async () => {
      prismaMock.jobRun.update.mockResolvedValue(
        fakeJob({ status: 'failed', errorCode: 'GEN_ERR', errorMessage: 'Generation failed' })
      );
      prismaMock.jobRun.findUnique.mockResolvedValue(fakeJob({ logs: [] }));

      await failJobRun('job-1', 'GEN_ERR', 'Generation failed');

      expect(prismaMock.jobRun.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          status: 'failed',
          errorCode: 'GEN_ERR',
          errorMessage: 'Generation failed',
          completedAt: expect.any(Date),
        }),
      });
    });

    it('failJobRun accepts a custom status like cancelled', async () => {
      prismaMock.jobRun.update.mockResolvedValue(fakeJob({ status: 'cancelled' }));
      prismaMock.jobRun.findUnique.mockResolvedValue(fakeJob({ logs: [] }));

      await failJobRun('job-1', 'CANCELLED', 'User cancelled', 'cancelled');

      expect(prismaMock.jobRun.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          status: 'cancelled',
        }),
      });
    });
  });
});

describe('markJobProgress', () => {
  it('clamps progress between 0 and 100', async () => {
    prismaMock.jobRun.update.mockResolvedValue(fakeJob());

    await markJobProgress('job-1', 150);

    expect(prismaMock.jobRun.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { progress: 100 },
    });
  });

  it('rounds progress and appends log when message provided', async () => {
    prismaMock.jobRun.update.mockResolvedValue(fakeJob());
    prismaMock.jobRun.findUnique.mockResolvedValue(fakeJob({ logs: [] }));

    await markJobProgress('job-1', 33.7, 'Processing slides');

    expect(prismaMock.jobRun.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { progress: 34 },
    });
    // appendJobLog is called internally — verify the log update
    expect(prismaMock.jobRun.update).toHaveBeenCalledTimes(2);
  });
});

describe('job log management', () => {
  it('appendJobLog reads existing logs, appends, and writes back', async () => {
    const existingLogs = [
      { timestamp: '2024-01-01T00:00:00Z', message: 'Started', level: 'info' },
    ];
    prismaMock.jobRun.findUnique.mockResolvedValue(fakeJob({ logs: existingLogs }));
    prismaMock.jobRun.update.mockResolvedValue(fakeJob());

    await appendJobLog('job-1', 'Step 2 done', 'success', { step: 2 });

    expect(prismaMock.jobRun.findUnique).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      select: { logs: true },
    });

    const updateCall = prismaMock.jobRun.update.mock.calls[0];
    const writtenLogs = updateCall[0].data.logs;
    expect(writtenLogs).toHaveLength(2);
    expect(writtenLogs[0]).toEqual(existingLogs[0]);
    expect(writtenLogs[1]).toMatchObject({
      message: 'Step 2 done',
      level: 'success',
      meta: { step: 2 },
    });
    expect(writtenLogs[1].timestamp).toBeDefined();
  });

  it('readJobLogs returns empty array for non-array input', () => {
    expect(readJobLogs(null)).toEqual([]);
    expect(readJobLogs(undefined)).toEqual([]);
    expect(readJobLogs('not-an-array')).toEqual([]);
  });

  it('readJobLogs filters out malformed entries', () => {
    const input = [
      { timestamp: '2024-01-01', message: 'ok', level: 'info' },
      { noTimestamp: true },
      42,
      null,
      { timestamp: '2024-01-02', message: 'warn', level: 'warn' },
    ];

    const result = readJobLogs(input);
    expect(result).toHaveLength(2);
    expect(result[0].message).toBe('ok');
    expect(result[1].level).toBe('warn');
  });

  it('readJobLogs defaults unknown levels to info', () => {
    const input = [{ timestamp: '2024-01-01', message: 'test', level: 'debug' }];
    const result = readJobLogs(input);
    expect(result[0].level).toBe('info');
  });
});

describe('serializeJobRun', () => {
  it('maps job fields and parses logs', () => {
    const job = fakeJob({
      logs: [{ timestamp: '2024-01-01', message: 'hello', level: 'info' }],
    });

    const result = serializeJobRun(job as any);

    expect(result.id).toBe('job-1');
    expect(result.status).toBe('queued');
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0].message).toBe('hello');
    expect(result.error).toBeNull();
  });
});

describe('query helpers', () => {
  it('getJobRun queries by id and workspaceId', async () => {
    prismaMock.jobRun.findFirst.mockResolvedValue(fakeJob());

    await getJobRun('job-1', 'ws-1');

    expect(prismaMock.jobRun.findFirst).toHaveBeenCalledWith({
      where: { id: 'job-1', workspaceId: 'ws-1' },
    });
  });

  it('getJobRunById queries by id only', async () => {
    prismaMock.jobRun.findUnique.mockResolvedValue(fakeJob());

    await getJobRunById('job-1');

    expect(prismaMock.jobRun.findUnique).toHaveBeenCalledWith({
      where: { id: 'job-1' },
    });
  });

  it('getLatestDeckJob orders by createdAt desc', async () => {
    prismaMock.jobRun.findFirst.mockResolvedValue(fakeJob());

    await getLatestDeckJob('deck-1', 'ws-1');

    expect(prismaMock.jobRun.findFirst).toHaveBeenCalledWith({
      where: { deckId: 'deck-1', workspaceId: 'ws-1' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('attachWorkflowRunId updates runId on the job', async () => {
    prismaMock.jobRun.update.mockResolvedValue(fakeJob({ runId: 'run-abc' }));

    await attachWorkflowRunId('job-1', 'run-abc');

    expect(prismaMock.jobRun.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { runId: 'run-abc' },
    });
  });
});
