import { NextRequest, NextResponse } from 'next/server';
import { getJob } from '@/lib/job-queue';
import { getCurrentWorkspace } from '@/lib/workspace';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { workspace } = await getCurrentWorkspace();
    const jobId = (await params).jobId;
    const job = getJob(jobId);

    if (!job || job.workspaceId !== workspace.id) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    return NextResponse.json({
      id: job.id,
      deckId: job.deckId,
      status: job.status,
      progress: job.progress,
      logs: job.logs,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
    });
  } catch (error) {
    console.error('[API] Error fetching job:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch job',
      },
      { status: 500 }
    );
  }
}
