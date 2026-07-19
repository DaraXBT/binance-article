import { NextRequest, NextResponse } from 'next/server';
import {
  consumeGenerateAccessGrant,
  grantGenerateAccess,
  isGenerateAccessEnabled,
} from '@/lib/generate-access';
import { requireActiveUser } from '@/server/auth/authorization';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { consumeAtomicRateLimit } from '@/server/http/atomic-rate-limit';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { readBoundedJson } from '@/server/http/request-body';
import { requireActorWorkspace } from '@/server/modules/workspace/membership';

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export async function POST(request: NextRequest) {
  try {
    assertAllowedOrigin(request);
    const actor = await requireActiveUser(request);
    const body = await readBoundedJson(request, 1_024);
    const code = typeof body === 'object' && body !== null &&
      typeof (body as { code?: unknown }).code === 'string'
      ? (body as { code: string }).code
      : '';

    if (!isGenerateAccessEnabled()) {
      return NextResponse.json(
        { success: true, enabled: false },
        { headers: withNoStoreHeaders() },
      );
    }

    const now = new Date();
    const database = getRuntimeDatabase();
    const { allowed, resetAt } = await consumeAtomicRateLimit({
      database,
      key: `generate-access:${actor.id}`,
      limit: RATE_LIMIT,
      windowMs: RATE_WINDOW_MS,
      now,
    });

    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.', code: 'RATE_LIMITED' },
        {
          status: 429,
          headers: {
            ...withNoStoreHeaders(),
            'Retry-After': String(Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000))),
          },
        }
      );
    }

    const workspace = await requireActorWorkspace(database, actor.id);
    const result = await consumeGenerateAccessGrant({
      code,
      workspaceId: workspace.id,
      sessionId: actor.sessionId,
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
      status: 500,
    });
  }
}
