import { NextRequest, NextResponse } from 'next/server';
import { deleteDeckProject, getDeckWithAssets, updateDeckProject } from '@/lib/db';
import { UpdateDeckProjectSchema } from '@/lib/schemas';
import { authorizeArticleRequest } from '@/server/auth/article-authorization';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { readBoundedJson } from '@/server/http/request-body';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const deckId = (await params).id;
    const { workspaceId } = await authorizeArticleRequest(request, deckId);
    const deck = await getDeckWithAssets(deckId, workspaceId);

    if (!deck) {
      return NextResponse.json(
        { error: 'Article not found', code: 'ARTICLE_NOT_FOUND' },
        { status: 404, headers: withNoStoreHeaders() }
      );
    }

    return NextResponse.json(deck, {
      headers: withNoStoreHeaders(),
    });
  } catch (error) {
    return errorResponse(error, {
      code: 'ARTICLE_FETCH_FAILED',
      message: 'Failed to fetch article.',
      status: 500,
    });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertAllowedOrigin(request);
    const deckId = (await params).id;
    const { workspaceId } = await authorizeArticleRequest(request, deckId);
    const body = await readBoundedJson(request, 64_000);
    const data = UpdateDeckProjectSchema.parse(body);

    const deck = await updateDeckProject(deckId, workspaceId, data);
    return NextResponse.json(deck, {
      headers: withNoStoreHeaders(),
    });
  } catch (error) {
    return errorResponse(error, {
      code: 'ARTICLE_UPDATE_FAILED',
      message: 'Failed to update article.',
      status: 400,
    });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertAllowedOrigin(request);
    const deckId = (await params).id;
    const { workspaceId } = await authorizeArticleRequest(request, deckId);

    await deleteDeckProject(deckId, workspaceId);

    return NextResponse.json(
      { success: true },
      {
        headers: withNoStoreHeaders(),
      }
    );
  } catch (error) {
    return errorResponse(error, {
      code: 'ARTICLE_DELETE_FAILED',
      message: 'Failed to delete article.',
      status: 500,
    });
  }
}
