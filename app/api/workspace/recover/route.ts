import { NextRequest, NextResponse } from 'next/server';

import { WorkspaceRecoverSchema } from '@/lib/schemas';
import { recoverWorkspaceForCurrentSession } from '@/lib/workspace';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = WorkspaceRecoverSchema.parse(body);
    const workspace = await recoverWorkspaceForCurrentSession(validated.accessKey);

    if (!workspace) {
      return NextResponse.json({ error: 'Invalid access key' }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      workspaceId: workspace.id,
      accessKeyPrefix: workspace.accessKeyPrefix,
    });
  } catch (error) {
    console.error('[API] Error recovering workspace:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to recover workspace',
      },
      { status: 400 }
    );
  }
}
