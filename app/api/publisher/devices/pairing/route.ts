import { NextRequest, NextResponse } from 'next/server';

import { requireActiveUser } from '@/server/auth/authorization';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { readBoundedJson } from '@/server/http/request-body';
import { createPublisherDeviceRepository } from '@/server/modules/publisher/devices/repository';
import { createPublisherDevicePairing } from '@/server/modules/publisher/devices/service';

export async function POST(request: NextRequest) {
  try {
    assertAllowedOrigin(request);
    const actor = await requireActiveUser(request);
    const body = await readBoundedJson(request, 4_096) as Record<string, unknown>;
    const pairing = await createPublisherDevicePairing({
      repository: createPublisherDeviceRepository(getRuntimeDatabase()),
      actorUserId: actor.id,
      workspaceId: typeof body?.workspaceId === 'string' ? body.workspaceId : '',
      name: typeof body?.name === 'string' ? body.name : '',
    });
    return NextResponse.json({
      ...pairing,
      expiresAt: pairing.expiresAt.toISOString(),
    }, {
      status: 201,
      headers: withNoStoreHeaders(),
    });
  } catch (error) {
    return errorResponse(error, {
      code: 'DEVICE_PAIRING_CREATE_FAILED',
      message: 'The publisher device pairing could not be created.',
      status: 400,
    });
  }
}
