import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getRuntimeDatabase } from '@/server/db/runtime';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { readBoundedJson } from '@/server/http/request-body';
import { createPublisherCommandRepository } from '@/server/modules/publisher/commands/repository';
import { beginDevicePublish } from '@/server/modules/publisher/commands/service';
import { createPublisherDeviceRepository } from '@/server/modules/publisher/devices/repository';
import { authenticatePublisherDevice } from '@/server/modules/publisher/devices/service';

const BodySchema = z.object({ revision: z.number().int().positive() }).strict();

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const database = getRuntimeDatabase();
    const device = await authenticatePublisherDevice({
      repository: createPublisherDeviceRepository(database),
      authorization: request.headers.get('authorization'),
    });
    const body = BodySchema.parse(await readBoundedJson(request, 4_096));
    const { id: commandId } = await context.params;
    const result = await beginDevicePublish({
      repository: createPublisherCommandRepository(database),
      deviceId: device.id,
      commandId,
      revision: body.revision,
    });
    return NextResponse.json(result, { headers: withNoStoreHeaders() });
  } catch (error) {
    return errorResponse(error, {
      code: 'PUBLISHER_BEGIN_FAILED',
      message: 'Publishing has not been authorized.',
      status: 400,
    });
  }
}
