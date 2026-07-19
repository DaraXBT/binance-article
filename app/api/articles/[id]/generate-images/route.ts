import { NextRequest, NextResponse } from 'next/server';

import { getCurrentRevisionContext } from '@/lib/db';
import { getRequestGenerateAccessState, isGenerateAccessEnabled } from '@/lib/generate-access';
import { GenerateImagesRequestSchema } from '@/lib/schemas';
import { authorizeArticleRequest } from '@/server/auth/article-authorization';
import { createGenerateAccessRequiredResponse } from '@/server/auth/generate-access-response';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { startWorkflow } from '@/server/integrations/workflow-client';
import { consumeAtomicRateLimit } from '@/server/http/atomic-rate-limit';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { readBoundedJson } from '@/server/http/request-body';
import { attachWorkflowRunId, createJobRun } from '@/server/modules/jobs/service';

export const maxDuration = 30;

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertAllowedOrigin(request);
    const deckId = (await params).id;
    const { actor, database, workspaceId } = await authorizeArticleRequest(request, deckId);
    const body = await readBoundedJson(request, 4_096);

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

    const now = new Date();
    const { allowed, resetAt } = await consumeAtomicRateLimit({
      database,
      key: `gen-images:${actor.id}`,
      limit: RATE_LIMIT,
      windowMs: RATE_WINDOW_MS,
      now,
    });

    if (!allowed) {
      return NextResponse.json(
        { error: 'Image generation rate limit exceeded. Please try again later.', code: 'RATE_LIMITED' },
        {
          status: 429,
          headers: {
            ...withNoStoreHeaders(),
            'Retry-After': String(Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000))),
          },
        }
      );
    }
    const validated = GenerateImagesRequestSchema.parse(body);
    const revision = await getCurrentRevisionContext(deckId, workspaceId);

    const job = await createJobRun({
      deckId,
      workspaceId,
      kind: 'generate_images',
      articleRevisionId: revision.articleRevisionId,
      payload: {
        illustrationStyle: validated.illustrationStyle,
        mode: validated.mode,
      },
    });

    const run = await startWorkflow({ jobId: job.id, kind: 'generate_images' });
    await attachWorkflowRunId(job.id, run.runId);

    return NextResponse.json(
      {
        jobId: job.id,
        status: job.status,
        articleRevisionId: revision.articleRevisionId,
      },
      {
        status: 202,
        headers: withNoStoreHeaders(),
      }
    );
  } catch (error) {
    return errorResponse(error, {
      code: 'IMAGE_GENERATION_START_FAILED',
      message: 'Failed to start image generation.',
      status: 400,
    });
  }
}
