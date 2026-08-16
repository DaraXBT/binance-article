import { NextRequest, NextResponse } from 'next/server';

import { readEnrollmentClaimCookie } from '@/server/auth/invitation-enrollment';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { createEnrollmentRepository } from '@/server/modules/enrollment/repository';
import { isEnrollmentClaimReady } from '@/server/modules/enrollment/service';

function responseHeaders() {
  return withNoStoreHeaders({ 'Referrer-Policy': 'no-referrer' });
}
export async function GET(request: NextRequest) {
  try {
    const claimToken = readEnrollmentClaimCookie(request);
    if (!claimToken) {
      return NextResponse.json({ ready: false }, { headers: responseHeaders() });
    }

    const ready = await isEnrollmentClaimReady({
      repository: createEnrollmentRepository(getRuntimeDatabase()),
      claimToken,
    });
    return NextResponse.json({ ready }, { headers: responseHeaders() });
  } catch (error) {
    const response = errorResponse(error, {
      code: 'ENROLLMENT_CLAIM_STATUS_FAILED',
      message: 'Enrollment access could not be checked.',
      status: 500,
    });
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  }
}
