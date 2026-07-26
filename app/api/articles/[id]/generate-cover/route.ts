import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getCurrentRevisionContext } from '@/lib/db';
import { getRequestGenerateAccessState, isGenerateAccessEnabled } from '@/lib/generate-access';
import { authorizeArticleRequest } from '@/server/auth/article-authorization';
import { createGenerateAccessRequiredResponse } from '@/server/auth/generate-access-response';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { consumeAtomicRateLimit } from '@/server/http/atomic-rate-limit';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { readBoundedJson } from '@/server/http/request-body';
import { startWorkflow } from '@/server/integrations/workflow-client';
import {
  attachWorkflowRunId,
  createJobRun,
  failJobRun,
  findActiveCoverJob,
  findIdempotentJob,
} from '@/server/modules/jobs/service';

export const maxDuration = 30;

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const IdempotencyKeySchema = z.string().uuid();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertAllowedOrigin(request);
    const deckId = (await params).id;
    const { actor, database, workspaceId } = await authorizeArticleRequest(request, deckId);
    await readBoundedJson(request, 1_024);

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

    // A cover is already being produced (full generation or a cover retry):
    // report that job instead of paying for a second concurrent image. Runs
    // before the rate limit so the replay never consumes a slot.
    const activeJob = await findActiveCoverJob(deckId, workspaceId);
    if (activeJob) {
      return NextResponse.json(
        {
          jobId: activeJob.id,
          status: activeJob.status,
          articleRevisionId: activeJob.articleRevisionId,
        },
        { status: 202, headers: withNoStoreHeaders() },
      );
    }

    const now = new Date();
    const { allowed, resetAt } = await consumeAtomicRateLimit({
      database,
      key: `gen-cover:${actor.id}`,
      limit: RATE_LIMIT,
      windowMs: RATE_WINDOW_MS,
      now,
    });
    if (!allowed) {
      return NextResponse.json(
        { error: 'Cover generation rate limit exceeded. Please try again later.', code: 'RATE_LIMITED' },
        {
          status: 429,
          headers: {
            ...withNoStoreHeaders(),
            'Retry-After': String(Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000))),
          },
        },
      );
    }

    const revision = await getCurrentRevisionContext(deckId, workspaceId);
    const payload = {
      illustrationStyle: revision.deck.illustrationStyle,
      mode: 'missing',
      scope: 'cover',
    };

    // Rate limiting runs before replay detection, so a replayed manual retry
    // still consumes a slot — acceptable for this user-triggered route.
    const rawIdempotencyKey = request.headers.get('Idempotency-Key');
    const idempotencyKey = rawIdempotencyKey === null
      ? undefined
      : IdempotencyKeySchema.parse(rawIdempotencyKey);

    const idempotencyLookup = { deckId, workspaceId, kind: 'generate_images' as const, payload };
    let job = idempotencyKey
      ? await findIdempotentJob({ idempotencyKey, ...idempotencyLookup })
      : null;
    let replayed = job !== null;

    if (!job) {
      try {
        job = await createJobRun({
          id: idempotencyKey,
          deckId,
          workspaceId,
          kind: 'generate_images',
          articleRevisionId: revision.articleRevisionId,
          payload,
        });
      } catch (createError) {
        // Two concurrent requests can race on the idempotency-key primary key;
        // the loser replays the winner's job.
        const raced = idempotencyKey
          ? await findIdempotentJob({ idempotencyKey, ...idempotencyLookup })
          : null;
        if (!raced) throw createError;
        job = raced;
        replayed = true;
      }
    }

    const canResumeWorkflow = job.status === 'queued' || job.status === 'running';
    if (!replayed || (!job.runId && canResumeWorkflow)) {
      try {
        const run = await startWorkflow({ jobId: job.id, kind: 'generate_images' });
        await attachWorkflowRunId(job.id, run.runId);
      } catch (workflowError) {
        await failJobRun(
          job.id,
          'WORKFLOW_START_FAILED',
          'Failed to start the cover generation workflow.',
        ).catch(() => null);
        throw workflowError;
      }
    }

    return NextResponse.json(
      {
        jobId: job.id,
        status: job.status,
        articleRevisionId: job.articleRevisionId ?? revision.articleRevisionId,
      },
      { status: 202, headers: withNoStoreHeaders() },
    );
  } catch (error) {
    return errorResponse(error, {
      code: 'COVER_GENERATION_START_FAILED',
      message: 'Failed to start cover generation.',
      status: 400,
    });
  }
}
