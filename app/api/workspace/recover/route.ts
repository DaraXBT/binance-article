import { NextRequest, NextResponse } from 'next/server';

import { WorkspaceRecoverSchema } from '@/lib/schemas';
import { recoverWorkspaceForCurrentSession } from '@/server/modules/workspace/service';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';

export async function POST(request: NextRequest) {
  try {
    assertAllowedOrigin(request);
    const body = await request.json();
    const validated = WorkspaceRecoverSchema.parse(body);
    const workspace = await recoverWorkspaceForCurrentSession(validated.accessKey);

    if (!workspace) {
      return NextResponse.json(
        { error: 'Invalid access key', code: 'INVALID_ACCESS_KEY' },
        { status: 400, headers: withNoStoreHeaders() }
      );
    }

    return NextResponse.json({
      success: true,
      workspaceId: workspace.id,
      accessKeyPrefix: workspace.accessKeyPrefix,
    }, {
      headers: withNoStoreHeaders(),
    });
  } catch (error) {
    return errorResponse(error, {
      code: 'WORKSPACE_RECOVER_FAILED',
      message: 'Failed to recover workspace.',
      status: 400,
    });
  }
}
