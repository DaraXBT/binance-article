import { NextRequest, NextResponse } from 'next/server';

import { hashInvitationToken } from '@/server/domain/invitations';
import { parseAuthEnvironment } from '@/server/auth/auth-policy';
import { serializeEnrollmentClaimCookie } from '@/server/auth/invitation-enrollment';
import { assertTrustedMutationOrigin } from '@/server/auth/origin';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { consumeAtomicRateLimit } from '@/server/http/atomic-rate-limit';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { readBoundedJson } from '@/server/http/request-body';
import { createEnrollmentRepository } from '@/server/modules/enrollment/repository';
import { claimLegacyInvitation } from '@/server/modules/enrollment/service';

const RATE_WINDOW_MS = 10 * 60 * 1_000;

async function fingerprint(value: string): Promise<string> {
  return hashInvitationToken(`xarticle:legacy-invitation-rate-limit:v1:${value}`);
}

function rateLimitResponse(resetAt: Date, now: Date) {
  return NextResponse.json({
    error: 'Too many invitation attempts. Try again shortly.',
    code: 'ENROLLMENT_RATE_LIMITED',
  }, {
    status: 429,
    headers: {
      ...withNoStoreHeaders({ 'Referrer-Policy': 'no-referrer' }),
      'Retry-After': String(Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1_000))),
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const environment = parseAuthEnvironment(process.env);
    assertTrustedMutationOrigin(request, environment.baseUrl);
    const body = await readBoundedJson(request, 4_096) as Record<string, unknown>;
    const token = typeof body?.token === 'string' ? body.token : '';
    const database = getRuntimeDatabase();
    const now = new Date();
    const ip = request.headers.get('cf-connecting-ip')?.trim().slice(0, 100) || 'unknown';
    for (const rateLimit of [
      { key: `legacy-invitation-ip:${await fingerprint(ip)}`, limit: 10 },
      { key: `legacy-invitation-token:${await fingerprint(token)}`, limit: 20 },
    ]) {
      const result = await consumeAtomicRateLimit({
        database,
        key: rateLimit.key,
        limit: rateLimit.limit,
        windowMs: RATE_WINDOW_MS,
        now,
      });
      if (!result.allowed) return rateLimitResponse(result.resetAt, now);
    }
    const claim = await claimLegacyInvitation({
      repository: createEnrollmentRepository(database),
      invitationToken: token,
    });
    const response = NextResponse.json({
      success: true,
      email: claim.email,
      expiresAt: claim.expiresAt.toISOString(),
    }, { headers: withNoStoreHeaders({ 'Referrer-Policy': 'no-referrer' }) });
    response.headers.append('Set-Cookie', serializeEnrollmentClaimCookie(claim.claimToken, {
      secure: environment.secureCookies,
    }));
    return response;
  } catch (error) {
    const response = errorResponse(error, {
      code: 'INVITATION_ACCEPT_FAILED',
      message: 'The invitation is invalid or expired.',
      status: 400,
    });
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  }
}
