import type { JobKind, JobStatus } from '@/lib/schemas';
import type { AppDatabase } from '@/server/db/client';

import type { JobLogEntry } from './service';

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
