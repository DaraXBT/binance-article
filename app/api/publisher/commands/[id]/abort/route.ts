import { NextRequest, NextResponse } from 'next/server';

import { getRuntimeDatabase } from '@/server/db/runtime';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { createPublisherCommandRepository } from '@/server/modules/publisher/commands/repository';
import { abortPublisherCommand } from '@/server/modules/publisher/commands/service';
import { createPublisherDeviceRepository } from '@/server/modules/publisher/devices/repository';
import { authenticatePublisherDevice } from '@/server/modules/publisher/devices/service';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const database = getRuntimeDatabase();
    const device = await authenticatePublisherDevice({
      repository: createPublisherDeviceRepository(database),
      authorization: request.headers.get('authorization'),
    });
    const payload = await request.json() as { revision?: unknown; reasonCode?: unknown };
    const { id: commandId } = await context.params;
    const result = await abortPublisherCommand({
      repository: createPublisherCommandRepository(database),
      deviceId: device.id,
      commandId,
      revision: payload.revision as number,
      reasonCode: payload.reasonCode,
    });
    return NextResponse.json(result, { headers: withNoStoreHeaders() });
  } catch (error) {
    return errorResponse(error, {
      code: 'PUBLISHER_COMMAND_ABORT_FAILED',
      message: 'Publisher command could not be cancelled.',
      status: 400,
    });
  }
}
