import { NextRequest, NextResponse } from 'next/server';

import { parseAuthEnvironment } from '@/server/auth/auth-policy';
import { requireEnrollmentUser } from '@/server/auth/authorization';
import {
  readEnrollmentClaimCookie,
  serializeExpiredEnrollmentClaimCookie,
} from '@/server/auth/invitation-enrollment';
import { assertTrustedMutationOrigin } from '@/server/auth/origin';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { AppError, errorResponse, isAppError, withNoStoreHeaders } from '@/server/http/errors';
import { createEnrollmentRepository } from '@/server/modules/enrollment/repository';
import {
  completeEnrollmentClaim,
  releaseEnrollmentClaim,
  reserveEnrollmentClaim,
} from '@/server/modules/enrollment/service';

function responseHeaders() {
  return withNoStoreHeaders({ 'Referrer-Policy': 'no-referrer' });
}

function invalidClaimError() {
  return new AppError({
    code: 'INVALID_ENROLLMENT_CLAIM',
    message: 'The enrollment attempt is invalid or no longer available.',
    status: 400,
  });
}

export async function POST(request: NextRequest) {
  const authEnvironment = (() => {
    try {
      return parseAuthEnvironment(process.env);
    } catch {
      return null;
    }
  })();
  let claimToken: string | null = null;
  let actor: Awaited<ReturnType<typeof requireEnrollmentUser>> | null = null;
  let repository: ReturnType<typeof createEnrollmentRepository> | null = null;

  try {
    if (!authEnvironment) throw new Error('Authentication is not configured.');
    assertTrustedMutationOrigin(request, authEnvironment.baseUrl);
    claimToken = readEnrollmentClaimCookie(request);
    if (!claimToken) throw invalidClaimError();
    actor = await requireEnrollmentUser(request);
    repository = createEnrollmentRepository(getRuntimeDatabase());

    const reservation = await reserveEnrollmentClaim({
      repository,
      claimToken,
      email: actor.email,
    });
    if (!reservation.reserved && reservation.userId !== actor.id) {
      throw new AppError({
        code: 'ENROLLMENT_IDENTITY_MISMATCH',
        message: 'This enrollment claim belongs to another account.',
        status: 403,
      });
    }

    const completed = await completeEnrollmentClaim({
      repository,
      claimToken,
      userId: actor.id,
    });
    const response = NextResponse.json({
      enrollment: {
        completed: true,
        replayed: completed.replayed,
        ...(completed.workspaceId ? { workspaceId: completed.workspaceId } : {}),
      },
    }, { headers: responseHeaders() });
    response.headers.append('Set-Cookie', serializeExpiredEnrollmentClaimCookie({
      secure: authEnvironment.secureCookies,
    }));
    return response;
  } catch (error) {
    if (claimToken && actor && repository) {
      await releaseEnrollmentClaim({
        repository,
        claimToken,
        email: actor.email,
      }).catch(() => undefined);
    }
    const response = errorResponse(error, {
      code: 'ENROLLMENT_COMPLETE_FAILED',
      message: 'Enrollment could not be completed. Try again.',
      status: 500,
    });
    response.headers.set('Referrer-Policy', 'no-referrer');
    if (
      authEnvironment && isAppError(error) &&
      ['INVALID_ENROLLMENT_CLAIM', 'ENROLLMENT_IDENTITY_MISMATCH', 'ACCOUNT_DISABLED']
        .includes(error.code)
    ) {
      response.headers.append('Set-Cookie', serializeExpiredEnrollmentClaimCookie({
        secure: authEnvironment.secureCookies,
      }));
    }
    return response;
  }
}
