import { NextRequest, NextResponse } from 'next/server';

import { assertAllowedOrigin } from '@/server/auth/origin';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { createPublisherDeviceRepository } from '@/server/modules/publisher/devices/repository';
import { activatePublisherDevice } from '@/server/modules/publisher/devices/service';

export async function POST(request: NextRequest) {
  try {
    assertAllowedOrigin(request);
    const body = await request.json();
    const activated = await activatePublisherDevice({
      repository: createPublisherDeviceRepository(getRuntimeDatabase()),
      pairingCode: typeof body?.pairingCode === 'string' ? body.pairingCode : '',
    });
    return NextResponse.json(activated, { headers: withNoStoreHeaders() });
  } catch (error) {
    return errorResponse(error, {
      code: 'DEVICE_PAIRING_FAILED',
      message: 'The pairing code is invalid or expired.',
      status: 400,
    });
  }
}
