import { NextRequest, NextResponse } from 'next/server';
import { requireActiveUser } from '@/server/auth/authorization';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { getJobRun, serializeJobRun } from '@/server/modules/jobs/service';
import { requireActorWorkspace } from '@/server/modules/workspace/membership';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const actor = await requireActiveUser(request);
    const workspace = await requireActorWorkspace(getRuntimeDatabase(), actor.id);
    const jobId = (await params).jobId;
    const job = await getJobRun(jobId, workspace.id);

    if (!job) {
      return NextResponse.json(
        { error: 'Job not found', code: 'JOB_NOT_FOUND' },
        { status: 404, headers: withNoStoreHeaders() }
      );
    }

    return NextResponse.json(serializeJobRun(job), {
      headers: withNoStoreHeaders(),
    });
  } catch (error) {
    return errorResponse(error, {
      code: 'JOB_FETCH_FAILED',
      message: 'Failed to fetch job.',
      status: 500,
    });
  }
}
