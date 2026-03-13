import { NextRequest, NextResponse } from 'next/server';
import { grantAppAccess, isValidAppAccessCode } from '@/lib/app-access';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { checkRateLimit } from '@/server/http/rate-limit';

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export async function POST(request: NextRequest) {
  try {
    assertAllowedOrigin(request);

    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const { allowed, resetAt } = await checkRateLimit(`access:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS);

    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.', code: 'RATE_LIMITED' },
        {
          status: 429,
          headers: {
            ...withNoStoreHeaders(),
            'Retry-After': String(Math.ceil((resetAt - Date.now()) / 1000)),
          },
        }
      );
    }

    const body = await request.json();
    const code = typeof body?.code === 'string' ? body.code : '';

    if (!(await isValidAppAccessCode(code))) {
      return NextResponse.json(
        { error: 'Invalid access code', code: 'INVALID_ACCESS_CODE' },
        { status: 400, headers: withNoStoreHeaders() }
      );
    }

    const response = NextResponse.json(
      { success: true },
      {
        headers: withNoStoreHeaders(),
      }
    );
    await grantAppAccess(response);
    return response;
  } catch (error) {
    return errorResponse(error, {
      code: 'ACCESS_GATE_FAILED',
      message: 'The access request could not be completed.',
      status: 400,
    });
  }
}
