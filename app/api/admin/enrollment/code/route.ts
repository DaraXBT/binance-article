import { NextRequest, NextResponse } from 'next/server';

import { parseAuthEnvironment } from '@/server/auth/auth-policy';
import { requireActiveUser } from '@/server/auth/authorization';
import { assertTrustedMutationOrigin } from '@/server/auth/origin';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { ownerMutationRateLimit } from '@/server/http/owner-mutation-rate-limit';
import { readBoundedJson } from '@/server/http/request-body';
import { createEnrollmentRepository } from '@/server/modules/enrollment/repository';
import {
  createInitialEnrollmentCode,
  getEnrollmentCodePepper,
} from '@/server/modules/enrollment/service';

export async function POST(request: NextRequest) {
  try {
    const environment = parseAuthEnvironment(process.env);
    assertTrustedMutationOrigin(request, environment.baseUrl);
    const actor = await requireActiveUser(request, { requireOwner: true });
    const database = getRuntimeDatabase();
    const rateLimited = await ownerMutationRateLimit({
      database,
      ownerUserId: actor.id,
      scope: 'enrollment_code',
    });
    if (rateLimited) return rateLimited;
    await readBoundedJson(request, 4_096);
    const created = await createInitialEnrollmentCode({
      repository: createEnrollmentRepository(database),
      actorUserId: actor.id,
      pepper: getEnrollmentCodePepper(),
    });
    const joinUrl = new URL('/join', environment.baseUrl);
    joinUrl.hash = `code=${created.code}`;
    return NextResponse.json({
      code: created.code,
      codePrefix: created.codePrefix,
      version: created.version,
      joinUrl: joinUrl.toString(),
    }, {
      status: 201,
      headers: withNoStoreHeaders({ 'Referrer-Policy': 'no-referrer' }),
    });
  } catch (error) {
    return errorResponse(error, {
      code: 'ENROLLMENT_CODE_CREATE_FAILED',
      message: 'The enrollment code could not be created.',
      status: 400,
    });
  }
}
