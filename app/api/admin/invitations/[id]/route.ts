import { NextRequest, NextResponse } from 'next/server';

import { requireActiveUser } from '@/server/auth/authorization';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { logEvent } from '@/server/http/log';
import { createInvitationAdminRepository } from '@/server/modules/admin/invitations/repository';
import { revokeInvitation } from '@/server/modules/admin/invitations/service';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertAllowedOrigin(request);
    const actor = await requireActiveUser(request, { requireOwner: true });
    const invitationId = (await params).id;
    const repository = createInvitationAdminRepository(getRuntimeDatabase());
    await revokeInvitation({ repository, invitationId, actorUserId: actor.id });

    // The Invitation table has no revokedByUserId column; the structured log
    // is the actor record (ids only, never tokens or emails).
    logEvent('info', 'admin.invitation.revoked', { invitationId, actorUserId: actor.id });

    return NextResponse.json({ revoked: true }, { headers: withNoStoreHeaders() });
  } catch (error) {
    return errorResponse(error, {
      code: 'INVITATION_REVOKE_FAILED',
      message: 'The invitation could not be revoked.',
      status: 400,
    });
  }
}
