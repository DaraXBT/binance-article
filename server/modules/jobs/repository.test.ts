import { describe, expect, it, vi } from 'vitest';

import { createJobRepository } from './repository';

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job_1', deckId: 'deck_1', workspaceId: 'workspace_1', kind: 'generate',
    status: 'queued', progress: 0, logs: [], errorCode: null, errorMessage: null,
    articleRevisionId: 'deck_1:rev:1', runId: null, payload: null, result: null,
    startedAt: null, completedAt: null,
    createdAt: new Date('2026-07-19T00:00:00.000Z'),
    updatedAt: new Date('2026-07-19T00:00:00.000Z'),
    ...overrides,
  };
}

function capturingClient(rows: unknown[] = [jobRow()]) {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const client = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({ text: strings.join('?'), values });
    return rows;
  });
  return { client, queries };
}

describe('Neon job repository', () => {
  it('creates rows with explicit IDs and timestamps instead of Prisma client defaults', async () => {
    const { client, queries } = capturingClient();
    const repository = createJobRepository({ $client: client } as never);
    const now = new Date('2026-07-19T12:00:00.000Z');

    await repository.create({
      id: 'job_1', deckId: 'deck_1', workspaceId: 'workspace_1', kind: 'generate',
      status: 'queued', progress: 0, articleRevisionId: 'deck_1:rev:1',
      payload: { mode: 'text' }, logs: [], now,
    });

    expect(queries[0]?.text).toMatch(/INSERT INTO "JobRun"/);
    expect(queries[0]?.text).toMatch(/"createdAt", "updatedAt"/);
    expect(queries[0]?.text).toMatch(/'queued'::"JobStatus"/);
    expect(queries[0]?.text).toMatch(/'\[\]'::jsonb/);
    expect(queries[0]?.values).toEqual(expect.arrayContaining(['job_1', now]));
  });

  it('appends JSONB logs in one update without a race-prone read', async () => {
    const { client, queries } = capturingClient();
    const repository = createJobRepository({ $client: client } as never);
    const now = new Date('2026-07-19T12:00:00.000Z');

    await repository.appendLog({
      jobId: 'job_1',
      log: { timestamp: now.toISOString(), message: 'Step', level: 'info' },
      now,
    });

    expect(client).toHaveBeenCalledTimes(1);
    expect(queries[0]?.text).toMatch(/UPDATE "JobRun"/);
    expect(queries[0]?.text).toMatch(/COALESCE\("logs", '\[\]'::jsonb\) \|\|/);
    expect(queries[0]?.text).toMatch(/jsonb_build_array/);
    expect(queries[0]?.text).not.toMatch(/SELECT/);
  });

  it('guards terminal transitions and writes their log atomically', async () => {
    const { client, queries } = capturingClient();
    const repository = createJobRepository({ $client: client } as never);
    const now = new Date('2026-07-19T12:00:00.000Z');

    await repository.complete({
      jobId: 'job_1', result: { count: 2 },
      log: { timestamp: now.toISOString(), message: 'Done', level: 'success' }, now,
    });

    expect(queries[0]?.text).toMatch(/"status" = 'completed'/);
    expect(queries[0]?.text).toMatch(/"progress" = 100/);
    expect(queries[0]?.text).toMatch(/"status" IN \('queued', 'running'\)/);
    expect(queries[0]?.text).toMatch(/jsonb_build_array/);
  });

  it('keeps lookups tenant-scoped and latest ordering deterministic', async () => {
    const { client, queries } = capturingClient();
    const repository = createJobRepository({ $client: client } as never);

    await repository.findForWorkspace('job_1', 'workspace_1');
    await repository.findLatestForDeck('deck_1', 'workspace_1');

    expect(queries[0]?.text).toMatch(/WHERE "id" = [\s\S]+ AND "workspaceId" =/);
    expect(queries[1]?.text).toMatch(/WHERE "deckId" = [\s\S]+ AND "workspaceId" =/);
    expect(queries[1]?.text).toMatch(/ORDER BY "createdAt" DESC, "id" DESC/);
  });

  it('attaches a workflow id only when empty or already equal', async () => {
    const { client, queries } = capturingClient();
    const repository = createJobRepository({ $client: client } as never);
    const now = new Date('2026-07-19T12:00:00.000Z');

    await repository.attachWorkflowRunId({ jobId: 'job_1', runId: 'run_1', now });

    expect(queries[0]?.text).toMatch(/"runId" IS NULL OR "runId" =/);
    expect(queries[0]?.text).toMatch(/"status" IN \('queued', 'running'\)/);
  });

  it('serializes same-key creation and consumes the rate limit only for the insert winner', async () => {
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const capture = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = { text: strings.join('?'), values };
      queries.push(query);
      return query;
    };
    const transaction = vi.fn(async (
      build: (query: typeof capture) => Array<{ text: string; values: unknown[] }>,
    ) => {
      const statements = build(capture);
      return statements.map((_statement, index) => index === 1 ? [{
        result: {
          outcome: 'job',
          replayed: false,
          job: {
            ...jobRow(),
            createdAt: '2026-07-19T00:00:00.000Z',
            updatedAt: '2026-07-19T00:00:00.000Z',
          },
        },
      }] : []);
    });
    const client = Object.assign(vi.fn(), { transaction });
    const repository = createJobRepository({ $client: client } as never);

    await expect(repository.createGenerationIdempotently({
      id: '11111111-1111-4111-8111-111111111111',
      deckId: 'deck_1',
      workspaceId: 'workspace_1',
      payload: { mode: 'prompt' },
      now: new Date('2026-07-19T12:00:00.000Z'),
      rateLimit: { key: 'generate:user_1', limit: 10, windowMs: 3_600_000 },
    })).resolves.toMatchObject({
      job: { id: 'job_1' }, replayed: false, rateLimited: false,
    });

    const sql = queries.map((query) => query.text).join('\n');
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(sql).not.toContain('9_173_021');
    expect(queries.flatMap((query) => query.values)).toContain(9_173_021);
    expect(sql).toMatch(/INSERT INTO "RateLimitBucket"/);
    expect(sql).toMatch(/WHERE NOT EXISTS \(SELECT 1 FROM existing\)/);
    expect(sql).toMatch(/allowed_new_request/);
    expect(sql).toMatch(/jsonb_build_object\([\s\S]*'rate_limited'/);
  });
});
