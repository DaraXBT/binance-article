import type { JobKind, JobStatus } from '@/lib/schemas';
import { getRuntimeDatabase } from '@/server/db/runtime';

import { createJobRepository, type JobRunRecord } from './repository';

export type JobLogLevel = 'info' | 'warn' | 'error' | 'success';

export type JobLogEntry = {
  timestamp: string;
  message: string;
  level: JobLogLevel;
  meta?: Record<string, unknown>;
};

function repository() {
  return createJobRepository(getRuntimeDatabase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toLogEntry(value: unknown): JobLogEntry | null {
  if (!isRecord(value)) return null;
  if (typeof value.timestamp !== 'string' || typeof value.message !== 'string') return null;

  const level = value.level === 'warn' || value.level === 'error' || value.level === 'success'
    ? value.level
    : 'info';
  return {
    timestamp: value.timestamp,
    message: value.message,
    level,
    meta: isRecord(value.meta) ? value.meta : undefined,
  };
}

function createLog(
  message: string,
  level: JobLogLevel,
  now: Date,
  meta?: Record<string, unknown>,
): JobLogEntry {
  return meta
    ? { timestamp: now.toISOString(), message, level, meta }
    : { timestamp: now.toISOString(), message, level };
}

export function readJobLogs(logs: unknown): JobLogEntry[] {
  if (!Array.isArray(logs)) return [];
  return logs.map(toLogEntry).filter((entry): entry is JobLogEntry => entry !== null);
}

export function serializeJobRun(job: JobRunRecord) {
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

export function createJobRun(input: {
  deckId: string;
  workspaceId: string;
  kind: JobKind;
  articleRevisionId: string;
  payload?: unknown;
}) {
  const now = new Date();
  return repository().create({
    id: crypto.randomUUID(),
    deckId: input.deckId,
    workspaceId: input.workspaceId,
    kind: input.kind,
    status: 'queued',
    progress: 0,
    articleRevisionId: input.articleRevisionId,
    payload: input.payload,
    logs: [],
    now,
  });
}

export function attachWorkflowRunId(jobId: string, runId: string) {
  return repository().attachWorkflowRunId({ jobId, runId, now: new Date() });
}

export function getJobRun(jobId: string, workspaceId: string) {
  return repository().findForWorkspace(jobId, workspaceId);
}

export function getJobRunById(jobId: string) {
  return repository().findById(jobId);
}

export function getLatestDeckJob(deckId: string, workspaceId: string) {
  return repository().findLatestForDeck(deckId, workspaceId);
}

export function appendJobLog(
  jobId: string,
  message: string,
  level: JobLogLevel = 'info',
  meta?: Record<string, unknown>,
) {
  const now = new Date();
  return repository().appendLog({
    jobId,
    log: createLog(message, level, now, meta),
    now,
  });
}

export function markJobRunning(jobId: string) {
  return repository().markRunning({ jobId, now: new Date() });
}

export function markJobProgress(
  jobId: string,
  progress: number,
  logMessage?: string,
  meta?: Record<string, unknown>,
) {
  const now = new Date();
  return repository().markProgress({
    jobId,
    progress: Math.max(0, Math.min(100, Math.round(progress))),
    log: logMessage ? createLog(logMessage, 'info', now, meta) : undefined,
    now,
  });
}

export function completeJobRun(
  jobId: string,
  result?: unknown,
  logMessage = 'Job completed successfully.',
) {
  const now = new Date();
  return repository().complete({
    jobId,
    result,
    log: createLog(logMessage, 'success', now),
    now,
  });
}

export function failJobRun(
  jobId: string,
  code: string,
  message: string,
  status: Extract<JobStatus, 'failed' | 'cancelled'> = 'failed',
  result?: unknown,
) {
  const now = new Date();
  return repository().fail({
    jobId,
    code,
    message,
    status,
    result,
    log: createLog(message, 'error', now),
    now,
  });
}
