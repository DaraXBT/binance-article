import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { parseAuthEnvironment } from '@/server/auth/auth-policy';
import { serializeEnrollmentClaimCookie } from '@/server/auth/invitation-enrollment';
import { assertTrustedMutationOrigin } from '@/server/auth/origin';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { consumeAtomicRateLimit } from '@/server/http/atomic-rate-limit';
import { AppError, errorResponse, isAppError, withNoStoreHeaders } from '@/server/http/errors';
import { readBoundedJson } from '@/server/http/request-body';
import { createEnrollmentRepository } from '@/server/modules/enrollment/repository';
import { hashEnrollmentCode, normalizeEnrollmentCode } from '@/server/modules/enrollment/domain';
import {
  claimEnrollmentCode,
  getEnrollmentCodePepper,
} from '@/server/modules/enrollment/service';

const ClaimRequestSchema = z.object({
  code: z.string().trim().min(1).max(64),
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
}).strict();

const IP_RATE_LIMIT = 10;
const CODE_RATE_LIMIT = 20;
const RATE_WINDOW_MS = 10 * 60 * 1_000;

async function fingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`xarticle:enrollment-rate-limit:v1:${value}`),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function throttled(resetAt: Date, now: Date) {
  return NextResponse.json({
    error: 'Too many enrollment attempts. Try again shortly.',
    code: 'ENROLLMENT_RATE_LIMITED',
  }, {
    status: 429,
    headers: {
      ...secureResponseHeaders(),
      'Retry-After': String(Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1_000))),
    },
  });
}

function secureResponseHeaders() {
  return withNoStoreHeaders({ 'Referrer-Policy': 'no-referrer' });
}

export async function POST(request: NextRequest) {
  try {
    const authEnvironment = parseAuthEnvironment(process.env);
    assertTrustedMutationOrigin(request, authEnvironment.baseUrl);
    const body = ClaimRequestSchema.parse(await readBoundedJson(request, 4_096));
    const headerKey = request.headers.get('idempotency-key')?.trim() || undefined;
    if (headerKey && body.idempotencyKey && headerKey !== body.idempotencyKey) {
      throw new AppError({
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'The enrollment attempt identifier is invalid.',
        status: 400,
      });
    }
    const idempotencyKey = headerKey ?? body.idempotencyKey;
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      throw new AppError({
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'The enrollment attempt identifier is invalid.',
        status: 400,
      });
    }

    const database = getRuntimeDatabase();
    const pepper = getEnrollmentCodePepper();
    const now = new Date();
    const ip = request.headers.get('cf-connecting-ip')?.trim().slice(0, 100) || 'unknown';
    const ipLimit = await consumeAtomicRateLimit({
      database,
      key: `enrollment-ip:${await fingerprint(ip)}`,
      limit: IP_RATE_LIMIT,
      windowMs: RATE_WINDOW_MS,
      now,
    });
    if (!ipLimit.allowed) return throttled(ipLimit.resetAt, now);

    let codeHash: string | null = null;
    try {
      codeHash = await hashEnrollmentCode(normalizeEnrollmentCode(body.code), pepper);
    } catch {
      // Malformed codes are still charged to the IP bucket and then mapped to
      // the same generic invalid-code response by the enrollment service.
    }
    if (codeHash) {
      const codeLimit = await consumeAtomicRateLimit({
        database,
        key: `enrollment-code:${codeHash}`,
        limit: CODE_RATE_LIMIT,
        windowMs: RATE_WINDOW_MS,
        now,
      });
      if (!codeLimit.allowed) return throttled(codeLimit.resetAt, now);
    }

    const repository = createEnrollmentRepository(database);
    const claim = await claimEnrollmentCode({
      repository,
      code: body.code,
      idempotencyKey,
      pepper,
    });
    const response = NextResponse.json({
      claim: {
        status: claim.status,
        expiresAt: claim.expiresAt.toISOString(),
      },
    }, {
      status: 201,
      headers: secureResponseHeaders(),
    });
    response.headers.append('Set-Cookie', serializeEnrollmentClaimCookie(claim.claimToken, {
      secure: authEnvironment.secureCookies,
    }));
    return response;
  } catch (error) {
    const response = errorResponse(error, {
      code: 'ENROLLMENT_CLAIM_FAILED',
      message: 'The enrollment code could not be checked.',
      status: 400,
    });
    response.headers.set('Referrer-Policy', 'no-referrer');
    if (isAppError(error) && error.status === 429) response.headers.set('Retry-After', '60');
    return response;
  }
}
