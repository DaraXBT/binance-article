import { NextRequest, NextResponse } from 'next/server';

import { WorkspaceRecoverSchema } from '@/lib/schemas';
import { recoverWorkspaceForCurrentSession } from '@/server/modules/workspace/service';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { checkRateLimit } from '@/server/http/rate-limit';

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export async function POST(request: NextRequest) {
  try {
    assertAllowedOrigin(request);

    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const { allowed, resetAt } = checkRateLimit(`recover:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS);

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
    const validated = WorkspaceRecoverSchema.parse(body);
    const workspace = await recoverWorkspaceForCurrentSession(validated.accessKey);

    if (!workspace) {
      return NextResponse.json(
        { error: 'Invalid access key', code: 'INVALID_ACCESS_KEY' },
        { status: 400, headers: withNoStoreHeaders() }
      );
    }

    return NextResponse.json({
      success: true,
      workspaceId: workspace.id,
      accessKeyPrefix: workspace.accessKeyPrefix,
    }, {
      headers: withNoStoreHeaders(),
    });
  } catch (error) {
    return errorResponse(error, {
      code: 'WORKSPACE_RECOVER_FAILED',
      message: 'Failed to recover workspace.',
      status: 400,
    });
  }
}
