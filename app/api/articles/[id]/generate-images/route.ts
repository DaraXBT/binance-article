import { NextRequest, NextResponse } from 'next/server';

import { getCurrentRevisionContext } from '@/lib/db';
import { getRequestGenerateAccessState, isGenerateAccessEnabled } from '@/lib/generate-access';
import { GenerateImagesRequestSchema } from '@/lib/schemas';
import { createGenerateAccessRequiredResponse } from '@/server/auth/generate-access-response';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { startWorkflow } from '@/server/integrations/workflow-client';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { checkRateLimit } from '@/server/http/rate-limit';
import { attachWorkflowRunId, createJobRun } from '@/server/modules/jobs/service';
import { getCurrentWorkspace } from '@/server/modules/workspace/service';
import { handleArticleImageRetryJob } from '@/workflows/article-jobs';

export const maxDuration = 30;

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertAllowedOrigin(request);

    const body = await request.json().catch(() => ({}));
    const { sessionId, workspace } = await getCurrentWorkspace();

    if (isGenerateAccessEnabled()) {
      const accessState = await getRequestGenerateAccessState(request, {
        workspaceId: workspace.id,
        sessionId,
      });

      if (!accessState.hasAccess) {
        return createGenerateAccessRequiredResponse({
          reason: accessState.invalidReason,
          clearCookie: accessState.invalidReason !== 'missing',
        });
      }
    }

    const { allowed, resetAt } = await checkRateLimit(
      `gen-images:${workspace.id}`,
      RATE_LIMIT,
      RATE_WINDOW_MS
    );

    if (!allowed) {
      return NextResponse.json(
        { error: 'Image generation rate limit exceeded. Please try again later.', code: 'RATE_LIMITED' },
        {
          status: 429,
          headers: {
            ...withNoStoreHeaders(),
            'Retry-After': String(Math.ceil((resetAt - Date.now()) / 1000)),
          },
        }
      );
    }
    const deckId = (await params).id;
    const validated = GenerateImagesRequestSchema.parse(body);
    const revision = await getCurrentRevisionContext(deckId, workspace.id);

    const job = await createJobRun({
      deckId,
      workspaceId: workspace.id,
      kind: 'generate_images',
      articleRevisionId: revision.articleRevisionId,
      payload: {
        illustrationStyle: validated.illustrationStyle,
        mode: validated.mode,
      },
    });

    const run = await startWorkflow(handleArticleImageRetryJob, [job.id]);
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
