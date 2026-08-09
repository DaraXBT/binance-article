import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { parseAuthEnvironment } from '@/server/auth/auth-policy';
import { requireActiveUser } from '@/server/auth/authorization';
import { assertTrustedMutationOrigin } from '@/server/auth/origin';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { ownerMutationRateLimit } from '@/server/http/owner-mutation-rate-limit';
import { readBoundedJson } from '@/server/http/request-body';
import { createEnrollmentRepository } from '@/server/modules/enrollment/repository';
import {
  getEnrollmentCodePepper,
  rotateEnrollmentCode,
} from '@/server/modules/enrollment/service';

const RotateRequestSchema = z.object({
  reason: z.string().trim().min(1).max(200).optional(),
}).strict();

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
    const body = RotateRequestSchema.parse(await readBoundedJson(request, 4_096));
    const rotated = await rotateEnrollmentCode({
      repository: createEnrollmentRepository(database),
      actorUserId: actor.id,
      reason: body.reason,
      pepper: getEnrollmentCodePepper(),
    });
    const joinUrl = new URL('/join', environment.baseUrl);
    joinUrl.hash = `code=${rotated.code}`;
    return NextResponse.json({
      code: rotated.code,
      codePrefix: rotated.codePrefix,
      version: rotated.version,
      revokedClaims: rotated.revokedClaims,
      joinUrl: joinUrl.toString(),
    }, { headers: withNoStoreHeaders({ 'Referrer-Policy': 'no-referrer' }) });
  } catch (error) {
    return errorResponse(error, {
      code: 'ENROLLMENT_CODE_ROTATE_FAILED',
      message: 'The enrollment code could not be rotated.',
      status: 400,
    });
  }
}
