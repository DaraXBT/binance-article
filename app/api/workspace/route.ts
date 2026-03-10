import { NextResponse } from 'next/server';

import { createWorkspaceForCurrentSession, getWorkspaceBootstrap } from '@/lib/workspace';

export async function GET() {
  try {
    const workspace = await getWorkspaceBootstrap();

    return NextResponse.json(workspace);
  } catch (error) {
    console.error('[API] Error fetching workspace:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch workspace',
      },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const created = await createWorkspaceForCurrentSession();

    return NextResponse.json({
      success: true,
      workspaceId: created.workspace.id,
      accessKeyPrefix: created.workspace.accessKeyPrefix,
      recoveryKey: created.recoveryKey,
    });
  } catch (error) {
    console.error('[API] Error creating workspace:', error);
    return NextResponse.json(
      {
        error: 'Failed to create workspace',
      },
      { status: 500 }
    );
  }
}
