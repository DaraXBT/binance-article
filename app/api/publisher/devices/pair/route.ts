import { NextRequest, NextResponse } from 'next/server';

import { assertAllowedOrigin } from '@/server/auth/origin';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { readBoundedJson } from '@/server/http/request-body';
import { createPublisherDeviceRepository } from '@/server/modules/publisher/devices/repository';
import { activatePublisherDevice } from '@/server/modules/publisher/devices/service';

export async function POST(request: NextRequest) {
  try {
    assertAllowedOrigin(request);
    const body = await readBoundedJson(request, 4_096) as Record<string, unknown>;
    const activated = await activatePublisherDevice({
      repository: createPublisherDeviceRepository(getRuntimeDatabase()),
      pairingCode: typeof body?.pairingCode === 'string' ? body.pairingCode : '',
      protocolVersion: body?.protocolVersion,
    });
    return NextResponse.json({
      device: {
        id: activated.device.id,
        name: activated.device.name,
        protocolVersion: activated.device.protocolVersion,
      },
      deviceToken: activated.deviceToken,
    }, { headers: withNoStoreHeaders() });
  } catch (error) {
    return errorResponse(error, {
      code: 'DEVICE_PAIRING_FAILED',
      message: 'The pairing code is invalid or expired.',
      status: 400,
    });
  }
}
