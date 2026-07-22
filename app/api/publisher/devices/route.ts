import { NextRequest, NextResponse } from 'next/server';

import { requireActiveUser } from '@/server/auth/authorization';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { createPublisherDeviceRepository } from '@/server/modules/publisher/devices/repository';
import { listPublisherDevices } from '@/server/modules/publisher/devices/service';
import { requireActorWorkspace } from '@/server/modules/workspace/membership';

export async function GET(request: NextRequest) {
  try {
    const actor = await requireActiveUser(request);
    const database = getRuntimeDatabase();
    const workspace = await requireActorWorkspace(database, actor.id);
    const devices = await listPublisherDevices({
      repository: createPublisherDeviceRepository(database),
      actorUserId: actor.id,
      workspaceId: workspace.id,
    });
    return NextResponse.json({
      devices: devices.map((device) => ({
        ...device,
        lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
      })),
    }, { headers: withNoStoreHeaders() });
  } catch (error) {
    return errorResponse(error, {
      code: 'PUBLISHER_DEVICES_READ_FAILED',
      message: 'Publisher devices could not be loaded.',
      status: 500,
    });
  }
}
