import { NextRequest, NextResponse } from 'next/server';

import { requireActiveUser } from '@/server/auth/authorization';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { AppError, errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { createBinanceDraftRepository } from '@/server/modules/publications/binance/draft-repository';
import { getBinanceDraft, saveBinanceDraft } from '@/server/modules/publications/binance/draft-service';
import { resolveArticleWorkspace } from '@/server/modules/workspace/membership';

type RouteContext = { params: Promise<{ id: string }> };

async function getAuthorizedArticle(request: NextRequest, context: RouteContext) {
  const actor = await requireActiveUser(request);
  const { id: articleId } = await context.params;
  const database = getRuntimeDatabase();
  const workspaceId = await resolveArticleWorkspace(database, actor.id, articleId);
  if (!workspaceId) {
    throw new AppError({ code: 'ARTICLE_NOT_FOUND', message: 'Article not found.', status: 404 });
  }
  return { actor, articleId, database, workspaceId };
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { actor, articleId, database, workspaceId } = await getAuthorizedArticle(request, context);
    const draft = await getBinanceDraft({
      repository: createBinanceDraftRepository(database),
      actorUserId: actor.id,
      workspaceId,
      articleId,
    });
    return NextResponse.json({ draft }, { headers: withNoStoreHeaders() });
  } catch (error) {
    return errorResponse(error, {
      code: 'PUBLICATION_DRAFT_READ_FAILED',
      message: 'The Binance publication draft could not be loaded.',
      status: 500,
    });
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    assertAllowedOrigin(request);
    const { actor, articleId, database, workspaceId } = await getAuthorizedArticle(request, context);
    const draft = await saveBinanceDraft({
      repository: createBinanceDraftRepository(database),
      actorUserId: actor.id,
      workspaceId,
      articleId,
      input: await request.json(),
    });
    return NextResponse.json({ draft }, { headers: withNoStoreHeaders() });
  } catch (error) {
    return errorResponse(error, {
      code: 'PUBLICATION_DRAFT_SAVE_FAILED',
      message: 'The Binance publication draft could not be saved.',
      status: 400,
    });
  }
}
