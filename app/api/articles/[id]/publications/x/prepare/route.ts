import { NextRequest, NextResponse } from 'next/server';

import { requireActiveUser } from '@/server/auth/authorization';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { AppError, errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { readBoundedJson } from '@/server/http/request-body';
import { createPublicationRepository } from '@/server/modules/publications/repository';
import { prepareXPublication } from '@/server/modules/publications/service';
import { resolveArticleWorkspace } from '@/server/modules/workspace/membership';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    assertAllowedOrigin(request);
    const actor = await requireActiveUser(request);
    const { id: articleId } = await context.params;
    const database = getRuntimeDatabase();
    const workspaceId = await resolveArticleWorkspace(database, actor.id, articleId);
    if (!workspaceId) {
      throw new AppError({ code: 'ARTICLE_NOT_FOUND', message: 'Article not found.', status: 404 });
    }
    const body = await readBoundedJson(request, 4_096) as Record<string, unknown>;
    const prepared = await prepareXPublication({
      repository: createPublicationRepository(database),
      actorUserId: actor.id,
      workspaceId,
      articleId,
      expectedRevision: typeof body?.expectedRevision === 'number' ? body.expectedRevision : Number.NaN,
    });
    return NextResponse.json(prepared, { status: 201, headers: withNoStoreHeaders() });
  } catch (error) {
    return errorResponse(error, {
      code: 'PUBLICATION_PREPARE_FAILED',
      message: 'The X publication could not be prepared.',
      status: 400,
    });
  }
}
