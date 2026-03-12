import { NextRequest, NextResponse } from 'next/server';
import { isValidGenerateAccessCode } from '@/lib/generate-access';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { checkRateLimit } from '@/server/http/rate-limit';

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export async function POST(request: NextRequest) {
  try {
    assertAllowedOrigin(request);

    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const { allowed, resetAt } = checkRateLimit(
      `generate-access:${clientIp}`,
      RATE_LIMIT,
      RATE_WINDOW_MS
    );

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

    if (!(await isValidGenerateAccessCode(code))) {
      return NextResponse.json(
        { error: 'Invalid generation code', code: 'INVALID_GENERATE_CODE' },
        { status: 400, headers: withNoStoreHeaders() }
      );
    }

    return NextResponse.json(
      { success: true },
      {
        headers: withNoStoreHeaders(),
      }
    );
  } catch (error) {
    return errorResponse(error, {
      code: 'GENERATE_ACCESS_FAILED',
      message: 'The generation access request could not be completed.',
      status: 400,
    });
  }
}
