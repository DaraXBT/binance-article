import type { JobKind, JobStatus } from '@/lib/schemas';
import type { AppDatabase } from '@/server/db/client';

import type { JobLogEntry } from './service';

const IDEMPOTENCY_LOCK_SEED = 9_173_021;

export interface JobRunRecord {
  id: string;
  deckId: string;
  workspaceId: string;
  kind: JobKind;
  status: JobStatus;
  progress: number;
  logs: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  articleRevisionId: string;
  runId: string | null;
  payload: unknown;
  result: unknown;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface JobRepository {
  create(input: {
    id: string;
    deckId: string;
    workspaceId: string;
    kind: JobKind;
    status: 'queued';
    progress: 0;
    articleRevisionId: string;
    payload?: unknown;
    logs: [];
    now: Date;
  }): Promise<JobRunRecord>;
  attachWorkflowRunId(input: {
    jobId: string;
    runId: string;
    now: Date;
  }): Promise<JobRunRecord | null>;
  findForWorkspace(jobId: string, workspaceId: string): Promise<JobRunRecord | null>;
  findById(jobId: string): Promise<JobRunRecord | null>;
  createGenerationIdempotently(input: {
    id: string;
    deckId: string;
    workspaceId: string;
    payload: unknown;
    now: Date;
    rateLimit?: {
      key: string;
      limit: number;
      windowMs: number;
    };
  }): Promise<
    | { job: JobRunRecord; replayed: boolean; rateLimited: false; resetAt: null }
    | { job: null; replayed: false; rateLimited: true; resetAt: Date }
    | null
  >;
  findLatestForDeck(deckId: string, workspaceId: string): Promise<JobRunRecord | null>;
  appendLog(input: {
    jobId: string;
    log: JobLogEntry;
    now: Date;
  }): Promise<JobRunRecord | null>;
  markRunning(input: { jobId: string; now: Date }): Promise<JobRunRecord | null>;
  markProgress(input: {
    jobId: string;
    progress: number;
    log?: JobLogEntry;
    now: Date;
  }): Promise<JobRunRecord | null>;
  complete(input: {
    jobId: string;
    result?: unknown;
    log: JobLogEntry;
    now: Date;
  }): Promise<JobRunRecord | null>;
  fail(input: {
    jobId: string;
    code: string;
    message: string;
    status: Extract<JobStatus, 'failed' | 'cancelled'>;
    result?: unknown;
    log: JobLogEntry;
    now: Date;
  }): Promise<JobRunRecord | null>;
}

function json(value: unknown): string {
  const serialized = JSON.stringify(value ?? null);
  if (serialized === undefined) throw new Error('Job JSON value is not serializable.');
  return serialized;
}

function firstJob(rows: unknown): JobRunRecord | null {
  if (!Array.isArray(rows)) throw new Error('Job query returned invalid data.');
  const row = rows[0];
  if (row === undefined) return null;
  if (!row || typeof row !== 'object' || typeof (row as { id?: unknown }).id !== 'string') {
    throw new Error('Job query returned invalid data.');
  }
  return row as JobRunRecord;
}

function requiredJob(rows: unknown): JobRunRecord {
  const job = firstJob(rows);
  if (!job) throw new Error('Job write did not return a row.');
  return job;
}

function dateValue(value: unknown): Date | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

function readIdempotentEnvelope(rows: unknown):
  | { job: JobRunRecord; replayed: boolean; rateLimited: false; resetAt: null }
  | { job: null; replayed: false; rateLimited: true; resetAt: Date }
  | null {
  if (!Array.isArray(rows)) throw new Error('Idempotent generation query returned invalid data.');
  const raw = (rows[0] as { result?: unknown } | undefined)?.result;
  let result = raw;
  if (typeof raw === 'string') {
    try {
      result = JSON.parse(raw);
    } catch {
      throw new Error('Idempotent generation query returned invalid JSON.');
    }
  }
  if (!result || typeof result !== 'object') return null;
  const envelope = result as Record<string, unknown>;
  if (envelope.outcome === 'rate_limited') {
    const resetAt = dateValue(envelope.resetAt);
    if (!resetAt) throw new Error('Idempotent rate limit returned an invalid reset time.');
    return { job: null, replayed: false, rateLimited: true, resetAt };
  }
  if (envelope.outcome !== 'job' || typeof envelope.replayed !== 'boolean') return null;
  const rawJob = envelope.job;
  if (!rawJob || typeof rawJob !== 'object' || typeof (rawJob as { id?: unknown }).id !== 'string') {
    throw new Error('Idempotent generation query returned an invalid job.');
  }
  const candidate = rawJob as Record<string, unknown>;
  const createdAt = dateValue(candidate.createdAt);
  const updatedAt = dateValue(candidate.updatedAt);
  if (!createdAt || !updatedAt) {
    throw new Error('Idempotent generation query returned invalid job timestamps.');
  }
  return {
    job: {
      ...(candidate as unknown as JobRunRecord),
      startedAt: dateValue(candidate.startedAt),
      completedAt: dateValue(candidate.completedAt),
      createdAt,
      updatedAt,
    },
    replayed: envelope.replayed,
    rateLimited: false,
    resetAt: null,
  };
}

export function createJobRepository(database: AppDatabase): JobRepository {
  return {
    async create(input) {
      const rows = await database.$client`
        INSERT INTO "JobRun" (
          "id", "deckId", "workspaceId", "kind", "status", "progress", "logs",
          "articleRevisionId", "payload", "createdAt", "updatedAt"
        ) VALUES (
          ${input.id}, ${input.deckId}, ${input.workspaceId},
          ${input.kind}::"JobKind", 'queued'::"JobStatus", 0, '[]'::jsonb,
          ${input.articleRevisionId}, ${json(input.payload)}::jsonb, ${input.now}, ${input.now}
        )
        RETURNING *
      `;
      return requiredJob(rows);
    },

    async attachWorkflowRunId(input) {
      const rows = await database.$client`
        UPDATE "JobRun"
        SET "runId" = ${input.runId}, "updatedAt" = ${input.now}
        WHERE "id" = ${input.jobId}
          AND "status" IN ('queued', 'running')
          AND ("runId" IS NULL OR "runId" = ${input.runId})
        RETURNING *
      `;
      return firstJob(rows);
    },

    async findForWorkspace(jobId, workspaceId) {
      const rows = await database.$client`
        SELECT * FROM "JobRun"
        WHERE "id" = ${jobId} AND "workspaceId" = ${workspaceId}
        LIMIT 1
      `;
      return firstJob(rows);
    },

    async findById(jobId) {
      const rows = await database.$client`
        SELECT * FROM "JobRun"
        WHERE "id" = ${jobId}
        LIMIT 1
      `;
      return firstJob(rows);
    },

    async createGenerationIdempotently(input) {
      if (!input.rateLimit) {
        const [, result] = await database.$client.transaction(
          (transaction) => [
            transaction`
              SELECT pg_advisory_xact_lock(
                hashtextextended(${input.id}, ${IDEMPOTENCY_LOCK_SEED})
              )
            `,
            transaction`
              WITH existing AS MATERIALIZED (
                SELECT job.*
                FROM "JobRun" AS job
                WHERE job."id" = ${input.id}
                LIMIT 1
              ), updated_deck AS (
                UPDATE "DeckProject" AS deck
                SET
                  "generationRevision" = deck."generationRevision" + 1,
                  "status" = 'queued'::"DeckStatus",
                  "updatedAt" = ${input.now}
                WHERE deck."id" = ${input.deckId}
                  AND deck."workspaceId" = ${input.workspaceId}
                  AND NOT EXISTS (SELECT 1 FROM existing)
                RETURNING deck."id", deck."generationRevision"
              ), inserted AS (
                INSERT INTO "JobRun" (
                  "id", "deckId", "workspaceId", "kind", "status", "progress", "logs",
                  "articleRevisionId", "payload", "createdAt", "updatedAt"
                )
                SELECT
                  ${input.id}, updated_deck."id", ${input.workspaceId},
                  'generate'::"JobKind", 'queued'::"JobStatus", 0, '[]'::jsonb,
                  updated_deck."id" || ':rev:' || updated_deck."generationRevision"::text,
                  ${json(input.payload)}::jsonb, ${input.now}, ${input.now}
                FROM updated_deck
                ON CONFLICT ("id") DO NOTHING
                RETURNING *
              )
              SELECT inserted.*, false AS "replayed" FROM inserted
              UNION ALL
              SELECT existing.*, true AS "replayed" FROM existing
              LIMIT 1
            `,
          ],
          { isolationLevel: 'ReadCommitted' },
        );
        const row = firstJob(result);
        if (!row) return null;
        const replayed = (row as JobRunRecord & { replayed?: unknown }).replayed;
        return {
          job: row,
          replayed: replayed === true,
          rateLimited: false as const,
          resetAt: null,
        };
      }

      const rateLimit = input.rateLimit;
      const nextResetAt = new Date(input.now.getTime() + rateLimit.windowMs);
      const boundedCount = rateLimit.limit + 1;
      const [, result] = await database.$client.transaction(
        (transaction) => [
          transaction`
            SELECT pg_advisory_xact_lock(
              hashtextextended(${input.id}, ${IDEMPOTENCY_LOCK_SEED})
            )
          `,
          transaction`
            WITH existing AS MATERIALIZED (
              SELECT job.*
              FROM "JobRun" AS job
              WHERE job."id" = ${input.id}
              LIMIT 1
            ), rate_limit AS MATERIALIZED (
              INSERT INTO "RateLimitBucket" (
                "key", "count", "resetAt", "createdAt", "updatedAt"
              )
              SELECT
                ${rateLimit.key}, 1, ${nextResetAt}, ${input.now}, ${input.now}
              WHERE NOT EXISTS (SELECT 1 FROM existing)
              ON CONFLICT ("key") DO UPDATE
              SET
                "count" = CASE
                  WHEN "RateLimitBucket"."resetAt" <= ${input.now} THEN 1
                  ELSE LEAST("RateLimitBucket"."count" + 1, ${boundedCount})
                END,
                "resetAt" = CASE
                  WHEN "RateLimitBucket"."resetAt" <= ${input.now} THEN ${nextResetAt}
                  ELSE "RateLimitBucket"."resetAt"
                END,
                "updatedAt" = ${input.now}
              RETURNING "count", "resetAt"
            ), allowed_new_request AS MATERIALIZED (
              SELECT 1 FROM rate_limit
              WHERE rate_limit."count" <= ${rateLimit.limit}
            ), updated_deck AS (
              UPDATE "DeckProject" AS deck
              SET
                "generationRevision" = deck."generationRevision" + 1,
                "status" = 'queued'::"DeckStatus",
                "updatedAt" = ${input.now}
              WHERE deck."id" = ${input.deckId}
                AND deck."workspaceId" = ${input.workspaceId}
                AND NOT EXISTS (SELECT 1 FROM existing)
                AND EXISTS (SELECT 1 FROM allowed_new_request)
              RETURNING deck."id", deck."generationRevision"
            ), inserted AS (
              INSERT INTO "JobRun" (
                "id", "deckId", "workspaceId", "kind", "status", "progress", "logs",
                "articleRevisionId", "payload", "createdAt", "updatedAt"
              )
              SELECT
                ${input.id}, updated_deck."id", ${input.workspaceId},
                'generate'::"JobKind", 'queued'::"JobStatus", 0, '[]'::jsonb,
                updated_deck."id" || ':rev:' || updated_deck."generationRevision"::text,
                ${json(input.payload)}::jsonb, ${input.now}, ${input.now}
              FROM updated_deck
              ON CONFLICT ("id") DO NOTHING
              RETURNING *
            ), selected_job AS MATERIALIZED (
              SELECT to_jsonb(inserted) AS "job", false AS "replayed" FROM inserted
              UNION ALL
              SELECT to_jsonb(existing) AS "job", true AS "replayed" FROM existing
              LIMIT 1
            )
            SELECT jsonb_build_object(
              'outcome', 'job',
              'job', selected_job."job",
              'replayed', selected_job."replayed"
            ) AS "result"
            FROM selected_job
            UNION ALL
            SELECT jsonb_build_object(
              'outcome', 'rate_limited',
              'resetAt', rate_limit."resetAt"
            ) AS "result"
            FROM rate_limit
            WHERE rate_limit."count" > ${rateLimit.limit}
            LIMIT 1
          `,
        ],
        { isolationLevel: 'ReadCommitted' },
      );
      return readIdempotentEnvelope(result);
    },

    async findLatestForDeck(deckId, workspaceId) {
      const rows = await database.$client`
        SELECT * FROM "JobRun"
        WHERE "deckId" = ${deckId} AND "workspaceId" = ${workspaceId}
        ORDER BY "createdAt" DESC, "id" DESC
        LIMIT 1
      `;
      return firstJob(rows);
    },

    async appendLog(input) {
      const rows = await database.$client`
        UPDATE "JobRun"
        SET
          "logs" = COALESCE("logs", '[]'::jsonb) ||
            jsonb_build_array(${json(input.log)}::jsonb),
          "updatedAt" = ${input.now}
        WHERE "id" = ${input.jobId}
        RETURNING *
      `;
      return firstJob(rows);
    },

    async markRunning(input) {
      const rows = await database.$client`
        UPDATE "JobRun"
        SET
          "status" = 'running'::"JobStatus",
          "startedAt" = COALESCE("startedAt", ${input.now}),
          "updatedAt" = ${input.now}
        WHERE "id" = ${input.jobId}
          AND "status" IN ('queued', 'running')
        RETURNING *
      `;
      return firstJob(rows);
    },

    async markProgress(input) {
      const rows = input.log
        ? await database.$client`
            UPDATE "JobRun"
            SET
              "progress" = ${input.progress},
              "logs" = COALESCE("logs", '[]'::jsonb) ||
                jsonb_build_array(${json(input.log)}::jsonb),
              "updatedAt" = ${input.now}
            WHERE "id" = ${input.jobId}
              AND "status" IN ('queued', 'running')
            RETURNING *
          `
        : await database.$client`
            UPDATE "JobRun"
            SET "progress" = ${input.progress}, "updatedAt" = ${input.now}
            WHERE "id" = ${input.jobId}
              AND "status" IN ('queued', 'running')
            RETURNING *
          `;
      return firstJob(rows);
    },

    async complete(input) {
      const rows = await database.$client`
        UPDATE "JobRun"
        SET
          "status" = 'completed'::"JobStatus",
          "progress" = 100,
          "result" = ${json(input.result)}::jsonb,
          "completedAt" = ${input.now},
          "logs" = COALESCE("logs", '[]'::jsonb) ||
            jsonb_build_array(${json(input.log)}::jsonb),
          "updatedAt" = ${input.now}
        WHERE "id" = ${input.jobId}
          AND "status" IN ('queued', 'running')
        RETURNING *
      `;
      return firstJob(rows);
    },

    async fail(input) {
      const rows = await database.$client`
        UPDATE "JobRun"
        SET
          "status" = ${input.status}::"JobStatus",
          "errorCode" = ${input.code},
          "errorMessage" = ${input.message},
          "result" = ${json(input.result)}::jsonb,
          "completedAt" = ${input.now},
          "logs" = COALESCE("logs", '[]'::jsonb) ||
            jsonb_build_array(${json(input.log)}::jsonb),
          "updatedAt" = ${input.now}
        WHERE "id" = ${input.jobId}
          AND "status" IN ('queued', 'running')
        RETURNING *
      `;
      return firstJob(rows);
    },
  };
}
