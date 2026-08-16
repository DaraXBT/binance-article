import { NextRequest, NextResponse } from 'next/server';

import { requireActiveUser } from '@/server/auth/authorization';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { consumeAtomicRateLimit } from '@/server/http/atomic-rate-limit';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { readBoundedJson } from '@/server/http/request-body';
import { createLegacyWorkspaceClaimRepository } from '@/server/modules/workspace/legacy-claim-repository';
import { claimLegacyWorkspace } from '@/server/modules/workspace/legacy-claim-service';

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export async function POST(request: NextRequest) {
  try {
    assertAllowedOrigin(request);
    const actor = await requireActiveUser(request);
    const body = await readBoundedJson(request, 1_024);
    const recoveryKey = typeof body === 'object' && body !== null &&
      typeof (body as { accessKey?: unknown }).accessKey === 'string'
      ? (body as { accessKey: string }).accessKey
      : '';
    const now = new Date();
    const database = getRuntimeDatabase();
    const { allowed, resetAt } = await consumeAtomicRateLimit({
      database,
      key: `legacy-workspace-claim:${actor.id}`,
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
            'Retry-After': String(Math.max(0, Math.ceil((resetAt.getTime() - Date.now()) / 1000))),
          },
        }
      );
    }
    const workspace = await claimLegacyWorkspace({
      repository: createLegacyWorkspaceClaimRepository(database),
      actorUserId: actor.id,
      recoveryKey,
      now,
    });

    return NextResponse.json({
      success: true,
      replacedWorkspace: workspace.replacedWorkspace,
    }, {
      headers: withNoStoreHeaders(),
    });
  } catch (error) {
    return errorResponse(error, {
      code: 'LEGACY_WORKSPACE_CLAIM_FAILED',
      message: 'Failed to import old data.',
      status: 500,
    });
  }
}
