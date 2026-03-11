import { NextRequest, NextResponse } from 'next/server';

import { getCurrentRevisionContext } from '@/lib/db';
import { GenerateImagesRequestSchema } from '@/lib/schemas';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { startWorkflow } from '@/server/integrations/workflow-client';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { attachWorkflowRunId, createJobRun } from '@/server/modules/jobs/service';
import { getCurrentWorkspace } from '@/server/modules/workspace/service';
import { handleArticleImageRetryJob } from '@/workflows/article-jobs';

export const maxDuration = 30;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertAllowedOrigin(request);
    const { workspace } = await getCurrentWorkspace();
    const deckId = (await params).id;
    const body = await request.json().catch(() => ({}));
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
