import { NextRequest, NextResponse } from 'next/server';

import { serializeInvitationEnrollmentCookie } from '@/server/auth/invitation-enrollment';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { readBoundedJson } from '@/server/http/request-body';
import { createInvitationAdminRepository } from '@/server/modules/admin/invitations/repository';
import { inspectInvitation } from '@/server/modules/admin/invitations/service';

export async function POST(request: NextRequest) {
  try {
    assertAllowedOrigin(request);
    const body = await readBoundedJson(request, 4_096) as Record<string, unknown>;
    const token = typeof body?.token === 'string' ? body.token : '';
    const repository = createInvitationAdminRepository(getRuntimeDatabase());
    const inspected = await inspectInvitation({ repository, token });
    const response = NextResponse.json({
      success: true,
      email: inspected.email,
    }, {
      headers: withNoStoreHeaders(),
    });
    response.headers.append('Set-Cookie', serializeInvitationEnrollmentCookie(token, {
      secure: new URL(request.url).protocol === 'https:',
    }));
    return response;
  } catch (error) {
    return errorResponse(error, {
      code: 'INVITATION_ACCEPT_FAILED',
      message: 'The invitation is invalid or expired.',
      status: 400,
    });
  }
}
