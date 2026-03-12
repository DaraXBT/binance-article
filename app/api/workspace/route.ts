import { NextRequest, NextResponse } from 'next/server';

import { createWorkspaceForCurrentSession, getWorkspaceBootstrap } from '@/server/modules/workspace/service';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';

export async function GET() {
  try {
    const workspace = await getWorkspaceBootstrap();

    return NextResponse.json(workspace, {
      headers: withNoStoreHeaders(),
    });
  } catch (error) {
    return errorResponse(error, {
      code: 'WORKSPACE_BOOTSTRAP_FAILED',
      message: 'Failed to fetch workspace.',
      status: 500,
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    assertAllowedOrigin(request);
    const created = await createWorkspaceForCurrentSession();

    return NextResponse.json({
      success: true,
      workspaceId: created.workspace.id,
      accessKeyPrefix: created.workspace.accessKeyPrefix,
      recoveryKey: created.recoveryKey,
    }, {
      headers: withNoStoreHeaders(),
    });
  } catch (error) {
    return errorResponse(error, {
      code: 'WORKSPACE_CREATE_FAILED',
      message: 'Failed to create workspace.',
      status: 500,
    });
  }
}
