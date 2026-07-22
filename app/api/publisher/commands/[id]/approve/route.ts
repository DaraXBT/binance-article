import { NextRequest, NextResponse } from 'next/server';

import { requireActiveUser } from '@/server/auth/authorization';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { readBoundedJson } from '@/server/http/request-body';
import { createWebPublishApprovalRepository } from '@/server/modules/publisher/approvals/repository';
import { approveWebPublication } from '@/server/modules/publisher/approvals/service';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertAllowedOrigin(request);
    const actor = await requireActiveUser(request);
    const { id: commandId } = await context.params;
    const body = await readBoundedJson(request, 4_096) as Record<string, unknown>;
    const command = await approveWebPublication({
      repository: createWebPublishApprovalRepository(getRuntimeDatabase()),
      actorUserId: actor.id,
      commandId,
      revision: body.revision,
      recipeHash: body.recipeHash,
      confirmed: body.confirmed,
    });
    return NextResponse.json({ command }, { headers: withNoStoreHeaders() });
  } catch (error) {
    return errorResponse(error, {
      code: 'PUBLISH_APPROVAL_FAILED',
      message: 'The publication could not be approved.',
      status: 400,
    });
  }
}
