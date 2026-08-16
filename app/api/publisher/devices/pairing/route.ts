import { NextRequest, NextResponse } from 'next/server';

import { requireActiveUser } from '@/server/auth/authorization';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { readBoundedJson } from '@/server/http/request-body';
import { createPublisherDeviceRepository } from '@/server/modules/publisher/devices/repository';
import { createPublisherDevicePairing } from '@/server/modules/publisher/devices/service';
import { requireActorWorkspace } from '@/server/modules/workspace/membership';

export async function POST(request: NextRequest) {
  try {
    assertAllowedOrigin(request);
    const actor = await requireActiveUser(request);
    const database = getRuntimeDatabase();
    const workspace = await requireActorWorkspace(database, actor.id);
    const body = await readBoundedJson(request, 4_096) as Record<string, unknown>;
    const pairing = await createPublisherDevicePairing({
      repository: createPublisherDeviceRepository(database),
      actorUserId: actor.id,
      workspaceId: workspace.id,
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
