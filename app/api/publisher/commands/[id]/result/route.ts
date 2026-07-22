import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getRuntimeDatabase } from '@/server/db/runtime';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { readBoundedJson } from '@/server/http/request-body';
import { createPublisherCommandRepository } from '@/server/modules/publisher/commands/repository';
import { reportPublishResult } from '@/server/modules/publisher/commands/service';
import { createPublisherDeviceRepository } from '@/server/modules/publisher/devices/repository';
import { authenticatePublisherDevice } from '@/server/modules/publisher/devices/service';

const ResultSchema = z.object({
  revision: z.number().int().positive(),
  outcome: z.enum(['succeeded', 'failed', 'outcome_unknown']),
  publishedUrl: z.string().url().optional(),
  failureReason: z.string().trim().min(1).max(500).optional(),
}).strict();

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
    const body = ResultSchema.parse(await readBoundedJson(request, 4_096));
    const { id: commandId } = await context.params;
    const result = await reportPublishResult({
      repository: createPublisherCommandRepository(database),
      deviceId: device.id,
      commandId,
      ...body,
    });
    return NextResponse.json(result, { headers: withNoStoreHeaders() });
  } catch (error) {
    return errorResponse(error, {
      code: 'PUBLISHER_RESULT_FAILED',
      message: 'The publisher result could not be recorded.',
      status: 400,
    });
  }
}
