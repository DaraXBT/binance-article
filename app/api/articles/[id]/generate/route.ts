import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { beginGenerationRevision } from '@/lib/db';
import { getRequestGenerateAccessState, isGenerateAccessEnabled } from '@/lib/generate-access';
import { GenerateRequestSchema } from '@/lib/schemas';
import { authorizeArticleRequest } from '@/server/auth/article-authorization';
import { createGenerateAccessRequiredResponse } from '@/server/auth/generate-access-response';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { startWorkflow } from '@/server/integrations/workflow-client';
import { consumeAtomicRateLimit } from '@/server/http/atomic-rate-limit';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { readBoundedJson } from '@/server/http/request-body';
import {
  attachWorkflowRunId,
  beginIdempotentGeneration,
  createJobRun,
  findIdempotentGeneration,
} from '@/server/modules/jobs/service';

export const maxDuration = 60;

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const IdempotencyKeySchema = z.string().uuid();

function generationRateLimitResponse(resetAt: Date) {
  return NextResponse.json(
    { error: 'Generation rate limit exceeded. Please try again later.', code: 'RATE_LIMITED' },
    {
      status: 429,
      headers: {
        ...withNoStoreHeaders(),
        'Retry-After': String(Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000))),
      },
    },
  );
}

async function consumeGenerationRateLimit({
  database,
  actorId,
}: {
  database: unknown;
  actorId: string;
}) {
  const now = new Date();
  const { allowed, resetAt } = await consumeAtomicRateLimit({
    database: database as never,
    key: `generate:${actorId}`,
    limit: RATE_LIMIT,
    windowMs: RATE_WINDOW_MS,
    now,
  });
  if (allowed) return null;
  return generationRateLimitResponse(resetAt);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertAllowedOrigin(request);
    const deckId = (await params).id;
    const { actor, database, workspaceId } = await authorizeArticleRequest(request, deckId);
    const body = await readBoundedJson(request, 64_000);

    if (isGenerateAccessEnabled()) {
      const accessState = await getRequestGenerateAccessState(request, {
        workspaceId,
        sessionId: actor.sessionId,
      });
      if (!accessState.hasAccess) {
        return createGenerateAccessRequiredResponse({
          reason: accessState.invalidReason,
          clearCookie: accessState.invalidReason !== 'missing',
        });
      }
    }

    const validated = GenerateRequestSchema.parse(body);
    const payload = {
      articleContent: validated.articleContent,
      slideCount: validated.slideCount,
      illustrationStyle: validated.illustrationStyle,
      mode: validated.mode,
    };
    const rawIdempotencyKey = request.headers.get('Idempotency-Key');
    const idempotencyKey = rawIdempotencyKey === null
      ? undefined
      : IdempotencyKeySchema.parse(rawIdempotencyKey);

    let job: {
      id: string;
      status: string;
      runId?: string | null;
      articleRevisionId: string;
    };
    let articleRevisionId: string;
    let replayed = false;

    if (idempotencyKey) {
      const existing = await findIdempotentGeneration({
        idempotencyKey,
        deckId,
        workspaceId,
        payload,
      });
      if (existing) {
        job = existing;
        articleRevisionId = existing.articleRevisionId;
        replayed = true;
      } else {
        const result = await beginIdempotentGeneration({
          idempotencyKey,
          deckId,
          workspaceId,
          payload,
          rateLimit: {
            key: `generate:${actor.id}`,
            limit: RATE_LIMIT,
            windowMs: RATE_WINDOW_MS,
          },
        });
        if (result.rateLimited) return generationRateLimitResponse(result.resetAt);
        job = result.job;
        articleRevisionId = result.job.articleRevisionId;
        replayed = result.replayed;
      }
    } else {
      const rateLimitResponse = await consumeGenerationRateLimit({
        database,
        actorId: actor.id,
      });
      if (rateLimitResponse) return rateLimitResponse;
      const revision = await beginGenerationRevision(deckId, workspaceId);
      articleRevisionId = revision.articleRevisionId;
      job = await createJobRun({
        deckId,
        workspaceId,
        kind: 'generate',
        articleRevisionId: revision.articleRevisionId,
        payload,
      });
    }

    const canResumeWorkflow = job.status === 'queued' || job.status === 'running';
    if (!replayed || (!job.runId && canResumeWorkflow)) {
      const run = await startWorkflow({ jobId: job.id, kind: 'generate' });
      await attachWorkflowRunId(job.id, run.runId);
    }

    return NextResponse.json(
      {
        jobId: job.id,
        status: job.status,
        articleRevisionId: articleRevisionId ?? job.articleRevisionId,
      },
      { status: 202, headers: withNoStoreHeaders() },
    );
  } catch (error) {
    return errorResponse(error, {
      code: 'ARTICLE_GENERATION_START_FAILED',
      message: 'Failed to start article generation.',
      status: 500,
    });
  }
}
