import { NextRequest, NextResponse } from 'next/server';
import {
  consumeGenerateAccessGrant,
  grantGenerateAccess,
  isGenerateAccessEnabled,
} from '@/lib/generate-access';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { checkRateLimit } from '@/server/http/rate-limit';
import { getCurrentWorkspace } from '@/server/modules/workspace/service';

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export async function POST(request: NextRequest) {
  try {
    assertAllowedOrigin(request);

    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const { allowed, resetAt } = await checkRateLimit(
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

    if (!isGenerateAccessEnabled()) {
      return NextResponse.json(
        { success: true, enabled: false },
        {
          headers: withNoStoreHeaders(),
        }
      );
    }

    const { sessionId, workspace } = await getCurrentWorkspace();
    const result = await consumeGenerateAccessGrant({
      code,
      workspaceId: workspace.id,
      sessionId,
    });

    if (!result.ok) {
      const message =
        result.reason === 'rotated'
          ? 'Generation access code has changed. Please request the latest code from the admin.'
          : result.reason === 'already_used'
            ? 'This generation access code is already being used by another browser session.'
            : result.reason === 'revoked'
              ? 'This generation access code is no longer active.'
              : 'Invalid generation code';

      return NextResponse.json(
        { error: message, code: 'INVALID_GENERATE_CODE', reason: result.reason },
        { status: 400, headers: withNoStoreHeaders() }
      );
    }

    const response = NextResponse.json({ success: true }, { headers: withNoStoreHeaders() });
    grantGenerateAccess(response, result.grantId);
    return response;
  } catch (error) {
    return errorResponse(error, {
      code: 'GENERATE_ACCESS_FAILED',
      message: 'The generation access request could not be completed.',
      status: 400,
    });
  }
}
