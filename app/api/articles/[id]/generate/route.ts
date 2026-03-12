import { NextRequest, NextResponse } from 'next/server';

import { beginGenerationRevision } from '@/lib/db';
import { isGenerateAccessEnabled, hasGrantedGenerateAccess } from '@/lib/generate-access';
import { GenerateRequestSchema } from '@/lib/schemas';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { startWorkflow } from '@/server/integrations/workflow-client';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { checkRateLimit } from '@/server/http/rate-limit';
import { attachWorkflowRunId, createJobRun } from '@/server/modules/jobs/service';
import { getCurrentWorkspace } from '@/server/modules/workspace/service';
import { handleArticleGenerationJob } from '@/workflows/article-jobs';

export const maxDuration = 60;

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertAllowedOrigin(request);

    if (isGenerateAccessEnabled()) {
      const hasAccess = await hasGrantedGenerateAccess(request);
      if (!hasAccess) {
        return NextResponse.json(
          { error: 'Generation access code required.', code: 'GENERATE_ACCESS_REQUIRED' },
          { status: 403, headers: withNoStoreHeaders() }
        );
      }
    }
    const { workspace } = await getCurrentWorkspace();

    const { allowed, resetAt } = checkRateLimit(`generate:${workspace.id}`, RATE_LIMIT, RATE_WINDOW_MS);

    if (!allowed) {
      return NextResponse.json(
        { error: 'Generation rate limit exceeded. Please try again later.', code: 'RATE_LIMITED' },
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
    const body = await request.json();
    const validated = GenerateRequestSchema.parse(body);

    const revision = await beginGenerationRevision(deckId, workspace.id);
    const job = await createJobRun({
      deckId,
      workspaceId: workspace.id,
      kind: 'generate',
      articleRevisionId: revision.articleRevisionId,
      payload: {
        articleContent: validated.articleContent,
        slideCount: validated.slideCount,
        illustrationStyle: validated.illustrationStyle,
        mode: validated.mode,
      },
    });

    const run = await startWorkflow(handleArticleGenerationJob, [job.id]);
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
      code: 'ARTICLE_GENERATION_START_FAILED',
      message: 'Failed to start article generation.',
      status: 500,
    });
  }
}
