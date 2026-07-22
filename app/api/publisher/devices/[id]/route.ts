import { NextRequest, NextResponse } from 'next/server';

import { requireActiveUser } from '@/server/auth/authorization';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { createPublisherDeviceRepository } from '@/server/modules/publisher/devices/repository';
import { revokePublisherDevice } from '@/server/modules/publisher/devices/service';
import { requireActorWorkspace } from '@/server/modules/workspace/membership';

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertAllowedOrigin(request);
    const actor = await requireActiveUser(request);
    const database = getRuntimeDatabase();
    const workspace = await requireActorWorkspace(database, actor.id);
    const { id: deviceId } = await context.params;
    const result = await revokePublisherDevice({
      repository: createPublisherDeviceRepository(database),
      actorUserId: actor.id,
      workspaceId: workspace.id,
      deviceId,
    });
    return NextResponse.json(result, { headers: withNoStoreHeaders() });
  } catch (error) {
    return errorResponse(error, {
      code: 'PUBLISHER_DEVICE_REVOKE_FAILED',
      message: 'Publisher device could not be revoked.',
      status: 400,
    });
  }
}
