import type { JobKind, JobStatus } from '@/lib/schemas';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { AppError } from '@/server/http/app-error';

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
  id?: string;
  deckId: string;
  workspaceId: string;
  kind: JobKind;
  articleRevisionId: string;
  payload?: unknown;
}) {
  const now = new Date();
  return repository().create({
    id: input.id ?? crypto.randomUUID(),
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

function canonicalJson(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite JSON number.');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalJson(value[key])]),
    );
  }
  throw new Error('Unsupported JSON value.');
}

function payloadMatches(actual: unknown, expected: unknown): boolean {
  try {
    return JSON.stringify(canonicalJson(actual ?? null)) ===
      JSON.stringify(canonicalJson(expected ?? null));
  } catch {
    return false;
  }
}

function idempotencyConflict(): AppError {
  return new AppError({
    code: 'IDEMPOTENCY_CONFLICT',
    message: 'This generation request conflicts with an earlier request.',
    status: 409,
  });
}

export async function findIdempotentJob(input: {
  idempotencyKey: string;
  deckId: string;
  workspaceId: string;
  kind: JobKind;
  payload: unknown;
}) {
  const job = await repository().findById(input.idempotencyKey);
  if (!job) return null;
  if (
    job.deckId !== input.deckId ||
    job.workspaceId !== input.workspaceId ||
    job.kind !== input.kind ||
    !payloadMatches(job.payload, input.payload)
  ) {
    throw idempotencyConflict();
  }
  return job;
}

export function findIdempotentGeneration(input: {
  idempotencyKey: string;
  deckId: string;
  workspaceId: string;
  payload: unknown;
}) {
  return findIdempotentJob({ ...input, kind: 'generate' });
}

export async function beginIdempotentGeneration(input: {
  idempotencyKey: string;
  deckId: string;
  workspaceId: string;
  payload: unknown;
  rateLimit?: {
    key: string;
    limit: number;
    windowMs: number;
  };
}) {
  if (input.rateLimit) {
    const key = input.rateLimit.key.trim();
    if (!key || key.length > 200) throw new Error('Rate-limit key is invalid.');
    if (
      !Number.isSafeInteger(input.rateLimit.limit) ||
      input.rateLimit.limit < 1 ||
      input.rateLimit.limit > 100_000
    ) {
      throw new Error('Rate-limit maximum is invalid.');
    }
    if (
      !Number.isSafeInteger(input.rateLimit.windowMs) ||
      input.rateLimit.windowMs < 1_000 ||
      input.rateLimit.windowMs > 86_400_000
    ) {
      throw new Error('Rate-limit window is invalid.');
    }
    input = { ...input, rateLimit: { ...input.rateLimit, key } };
  }
  const result = await repository().createGenerationIdempotently({
    id: input.idempotencyKey,
    deckId: input.deckId,
    workspaceId: input.workspaceId,
    payload: input.payload,
    now: new Date(),
    rateLimit: input.rateLimit,
  });
  if (!result) throw idempotencyConflict();
  if (result.rateLimited) return result;
  if (
    result.job.deckId !== input.deckId ||
    result.job.workspaceId !== input.workspaceId ||
    result.job.kind !== 'generate' ||
    !payloadMatches(result.job.payload, input.payload)
  ) {
    throw idempotencyConflict();
  }
  return result;
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
