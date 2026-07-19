import { NextRequest, NextResponse } from 'next/server';

import { requireActiveUser } from '@/server/auth/authorization';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { createInvitationAdminRepository } from '@/server/modules/admin/invitations/repository';
import { createInvitation } from '@/server/modules/admin/invitations/service';

export async function POST(request: NextRequest) {
  try {
    assertAllowedOrigin(request);
    const actor = await requireActiveUser(request, { requireOwner: true });
    const body = await request.json();
    const repository = createInvitationAdminRepository(getRuntimeDatabase());
    const created = await createInvitation({
      repository,
      actorUserId: actor.id,
      email: typeof body?.email === 'string' ? body.email : '',
    });
    const joinUrl = new URL('/join', request.url);
    joinUrl.searchParams.set('token', created.token);

    return NextResponse.json({
      invitation: {
        tokenPrefix: created.tokenPrefix,
        expiresAt: created.expiresAt.toISOString(),
        joinUrl: joinUrl.toString(),
      },
    }, {
      status: 201,
      headers: withNoStoreHeaders(),
    });
  } catch (error) {
    return errorResponse(error, {
      code: 'INVITATION_CREATE_FAILED',
      message: 'The invitation could not be created.',
      status: 400,
    });
  }
}
