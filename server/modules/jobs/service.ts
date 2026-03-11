import { type JobKind, type JobRun, type JobStatus, Prisma } from '@prisma/client';

import prisma from '@/server/integrations/prisma';

export type JobLogLevel = 'info' | 'warn' | 'error' | 'success';

export type JobLogEntry = {
  timestamp: string;
  message: string;
  level: JobLogLevel;
  meta?: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toLogEntry(value: unknown): JobLogEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.timestamp !== 'string' || typeof value.message !== 'string') {
    return null;
  }

  const level =
    value.level === 'warn' || value.level === 'error' || value.level === 'success'
      ? value.level
      : 'info';

  return {
    timestamp: value.timestamp,
    message: value.message,
    level,
    meta: isRecord(value.meta) ? value.meta : undefined,
  };
}

export function readJobLogs(logs: Prisma.JsonValue | null | undefined): JobLogEntry[] {
  if (!Array.isArray(logs)) {
    return [];
  }

  return logs.map((entry) => toLogEntry(entry)).filter((entry): entry is JobLogEntry => entry !== null);
}

export function serializeJobRun(job: JobRun) {
  return {
    id: job.id,
    deckId: job.deckId,
    workspaceId: job.workspaceId,
    kind: job.kind,
    status: job.status,
    progress: job.progress,
    logs: readJobLogs(job.logs),
    errorCode: job.errorCode,
    error: job.errorMessage,
    articleRevisionId: job.articleRevisionId,
    runId: job.runId,
    result: job.result,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export async function createJobRun(input: {
  deckId: string;
  workspaceId: string;
  kind: JobKind;
  articleRevisionId: string;
  payload?: Prisma.InputJsonValue;
}) {
  return prisma.jobRun.create({
    data: {
      deckId: input.deckId,
      workspaceId: input.workspaceId,
      kind: input.kind,
      status: 'queued',
      progress: 0,
      articleRevisionId: input.articleRevisionId,
      payload: input.payload,
      logs: [],
    },
  });
}

export async function attachWorkflowRunId(jobId: string, runId: string) {
  return prisma.jobRun.update({
    where: { id: jobId },
    data: { runId },
  });
}

export async function getJobRun(jobId: string, workspaceId: string) {
  return prisma.jobRun.findFirst({
    where: {
      id: jobId,
      workspaceId,
    },
  });
}

export async function getJobRunById(jobId: string) {
  return prisma.jobRun.findUnique({
    where: { id: jobId },
  });
}

export async function getLatestDeckJob(deckId: string, workspaceId: string) {
  return prisma.jobRun.findFirst({
    where: {
      deckId,
      workspaceId,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });
}

async function updateLogs(jobId: string, logs: JobLogEntry[]) {
  return prisma.jobRun.update({
    where: { id: jobId },
    data: {
      logs: logs as Prisma.InputJsonValue,
    },
  });
}

export async function appendJobLog(
  jobId: string,
  message: string,
  level: JobLogLevel = 'info',
  meta?: Record<string, unknown>
) {
  const job = await prisma.jobRun.findUnique({
    where: { id: jobId },
    select: { logs: true },
  });

  const logs = readJobLogs(job?.logs).concat({
    timestamp: new Date().toISOString(),
    message,
    level,
    meta,
  });

  await updateLogs(jobId, logs);
}

export async function markJobRunning(jobId: string) {
  return prisma.jobRun.update({
    where: { id: jobId },
    data: {
      status: 'running',
      startedAt: new Date(),
    },
  });
}

export async function markJobProgress(
  jobId: string,
  progress: number,
  logMessage?: string,
  meta?: Record<string, unknown>
) {
  await prisma.jobRun.update({
    where: { id: jobId },
    data: {
      progress: Math.max(0, Math.min(100, Math.round(progress))),
    },
  });

  if (logMessage) {
    await appendJobLog(jobId, logMessage, 'info', meta);
  }
}

export async function completeJobRun(
  jobId: string,
  result?: Prisma.InputJsonValue,
  logMessage = 'Job completed successfully.'
) {
  await prisma.jobRun.update({
    where: { id: jobId },
    data: {
      status: 'completed',
      progress: 100,
      result,
      completedAt: new Date(),
    },
  });

  await appendJobLog(jobId, logMessage, 'success');
}

export async function failJobRun(
  jobId: string,
  code: string,
  message: string,
  status: JobStatus = 'failed',
  result?: Prisma.InputJsonValue
) {
  await prisma.jobRun.update({
    where: { id: jobId },
    data: {
      status,
      errorCode: code,
      errorMessage: message,
      result,
      completedAt: new Date(),
    },
  });

  await appendJobLog(jobId, message, 'error');
}
