import { NextRequest, NextResponse } from 'next/server';

import { getRuntimeDatabase } from '@/server/db/runtime';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { createPublisherCommandRepository } from '@/server/modules/publisher/commands/repository';
import { getPublisherCommandStatus } from '@/server/modules/publisher/commands/service';
import { createPublisherDeviceRepository } from '@/server/modules/publisher/devices/repository';
import { authenticatePublisherDevice } from '@/server/modules/publisher/devices/service';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const database = getRuntimeDatabase();
    const device = await authenticatePublisherDevice({
      repository: createPublisherDeviceRepository(database),
      authorization: request.headers.get('authorization'),
    });
    const { id: commandId } = await context.params;
    const command = await getPublisherCommandStatus({
      repository: createPublisherCommandRepository(database),
      deviceId: device.id,
      commandId,
    });
    return NextResponse.json({ command }, { headers: withNoStoreHeaders() });
  } catch (error) {
    return errorResponse(error, {
      code: 'PUBLISHER_COMMAND_STATUS_FAILED',
      message: 'Publisher command status could not be loaded.',
      status: 400,
    });
  }
}
