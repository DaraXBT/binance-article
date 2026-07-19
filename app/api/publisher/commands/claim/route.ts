import { NextRequest, NextResponse } from 'next/server';

import { getRuntimeDatabase } from '@/server/db/runtime';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { createPublisherCommandRepository } from '@/server/modules/publisher/commands/repository';
import { claimNextPublisherCommand } from '@/server/modules/publisher/commands/service';
import { createPublisherDeviceRepository } from '@/server/modules/publisher/devices/repository';
import { authenticatePublisherDevice } from '@/server/modules/publisher/devices/service';

export async function POST(request: NextRequest) {
  try {
    const database = getRuntimeDatabase();
    const device = await authenticatePublisherDevice({
      repository: createPublisherDeviceRepository(database),
      authorization: request.headers.get('authorization'),
    });
    const command = await claimNextPublisherCommand({
      repository: createPublisherCommandRepository(database),
      deviceId: device.id,
    });
    if (!command) return new Response(null, { status: 204, headers: withNoStoreHeaders() });
    return NextResponse.json({ command }, { headers: withNoStoreHeaders() });
  } catch (error) {
    return errorResponse(error, {
      code: 'PUBLISHER_COMMAND_CLAIM_FAILED',
      message: 'A publisher command could not be claimed.',
      status: 400,
    });
  }
}
