import { NextRequest, NextResponse } from 'next/server';

import { getCurrentGenerateAccessState, isGenerateAccessEnabled } from '@/lib/generate-access';
import { requireActiveUser } from '@/server/auth/authorization';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { createAccountWorkspaceRepository } from '@/server/modules/workspace/account-repository';
import { createAccountWorkspace } from '@/server/modules/workspace/account-service';
import { resolveActorWorkspace } from '@/server/modules/workspace/membership';

export async function GET(request: NextRequest) {
  try {
    const actor = await requireActiveUser(request);
    const workspace = await resolveActorWorkspace(getRuntimeDatabase(), actor.id);
    const generateAccessEnabled = isGenerateAccessEnabled();
    const generationAccess = workspace && generateAccessEnabled
      ? await getCurrentGenerateAccessState({
          workspaceId: workspace.id,
          sessionId: actor.sessionId,
        })
      : null;

    return NextResponse.json({
      hasWorkspace: Boolean(workspace),
      workspaceId: workspace?.id ?? null,
      accessKeyPrefix: workspace?.accessKeyPrefix ?? null,
      recoveryKey: null,
      generateAccessEnabled,
      hasGenerationAccess: generationAccess?.hasAccess ?? false,
      generationAccessInvalidReason: generationAccess?.invalidReason ??
        (generateAccessEnabled ? 'missing' : null),
    }, {
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
    const actor = await requireActiveUser(request);
    const database = getRuntimeDatabase();
    const created = await createAccountWorkspace({
      repository: createAccountWorkspaceRepository(database),
      actorUserId: actor.id,
    });

    return NextResponse.json({
      success: true,
      workspaceId: created.id,
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
