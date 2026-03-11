import { NextRequest, NextResponse } from 'next/server';
import { deleteDeckProject, getDeckWithAssets, updateDeckProject } from '@/lib/db';
import { UpdateDeckProjectSchema } from '@/lib/schemas';
import { getCurrentWorkspace } from '@/server/modules/workspace/service';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspace } = await getCurrentWorkspace();
    const deckId = (await params).id;
    const deck = await getDeckWithAssets(deckId, workspace.id);

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
    const { workspace } = await getCurrentWorkspace();
    const deckId = (await params).id;
    const body = await request.json();
    const data = UpdateDeckProjectSchema.parse(body);

    const deck = await updateDeckProject(deckId, workspace.id, data);
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
    const { workspace } = await getCurrentWorkspace();
    const deckId = (await params).id;

    await deleteDeckProject(deckId, workspace.id);

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
