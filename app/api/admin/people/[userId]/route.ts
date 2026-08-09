import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { parseAuthEnvironment } from '@/server/auth/auth-policy';
import { requireActiveUser } from '@/server/auth/authorization';
import { assertTrustedMutationOrigin } from '@/server/auth/origin';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { ownerMutationRateLimit } from '@/server/http/owner-mutation-rate-limit';
import { readBoundedJson } from '@/server/http/request-body';
import { createEnrollmentAdminRepository } from '@/server/modules/admin/enrollment/repository';
import { updateEnrollmentPerson } from '@/server/modules/admin/enrollment/service';

const UpdatePersonSchema = z.object({
  action: z.enum(['suspend', 'revoke', 'restore']),
}).strict();

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const environment = parseAuthEnvironment(process.env);
    assertTrustedMutationOrigin(request, environment.baseUrl);
    const actor = await requireActiveUser(request, { requireOwner: true });
    const database = getRuntimeDatabase();
    const rateLimited = await ownerMutationRateLimit({
      database,
      ownerUserId: actor.id,
      scope: 'people_status',
    });
    if (rateLimited) return rateLimited;
    const body = UpdatePersonSchema.parse(await readBoundedJson(request, 4_096));
    const result = await updateEnrollmentPerson({
      repository: createEnrollmentAdminRepository(database),
      actorUserId: actor.id,
      userId: (await params).userId,
      action: body.action,
    });
    return NextResponse.json(result, {
      headers: withNoStoreHeaders({ 'Referrer-Policy': 'no-referrer' }),
    });
  } catch (error) {
    return errorResponse(error, {
      code: 'PEOPLE_UPDATE_FAILED',
      message: 'The user status could not be changed.',
      status: 400,
    });
  }
}
