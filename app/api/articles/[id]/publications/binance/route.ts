import { NextRequest, NextResponse } from 'next/server';

import { requireActiveUser } from '@/server/auth/authorization';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { getRuntimeDatabase } from '@/server/db/runtime';
import {
  PUBLICATION_DRAFT_REQUEST_MAX_BYTES,
  PublicationKindSchema,
  type PublicationKind,
} from '@/server/domain/publication-recipe';
import { AppError, errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { readBoundedJson } from '@/server/http/request-body';
import { createPublicationDraftRepository } from '@/server/modules/publications/draft-repository';
import { getPublicationDraft, savePublicationDraft } from '@/server/modules/publications/draft-service';
import { resolveArticleWorkspace } from '@/server/modules/workspace/membership';

type RouteContext = { params: Promise<{ id: string }> };

function publicationKind(value: unknown, fallback: PublicationKind): PublicationKind {
  const parsed = PublicationKindSchema.safeParse(value ?? fallback);
  if (!parsed.success) {
    throw new AppError({ code: 'INVALID_PUBLICATION_KIND', message: 'Publication kind is invalid.', status: 400 });
  }
  return parsed.data;
}

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
    const requestedKind = new URL(request.url).searchParams.get('kind');
    const kind = publicationKind(requestedKind ?? undefined, 'article');
    const draft = await getPublicationDraft({
      repository: createPublicationDraftRepository(database),
      actorUserId: actor.id,
      workspaceId,
      articleId,
      target: 'binance-square',
      ...(requestedKind !== null ? { kind } : {}),
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
    const body = await readBoundedJson(
      request,
      PUBLICATION_DRAFT_REQUEST_MAX_BYTES,
    ) as Record<string, unknown>;
    const kind = publicationKind(body.kind, 'article');
    const draft = await savePublicationDraft({
      repository: createPublicationDraftRepository(database),
      actorUserId: actor.id,
      workspaceId,
      articleId,
      target: 'binance-square',
      ...(body.kind !== undefined ? { kind } : {}),
      input: body,
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
