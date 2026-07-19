import { NextRequest, NextResponse } from 'next/server';
import { UpdateSlideSchema } from '@/lib/schemas';
import { updateSlide, deleteSlide } from '@/lib/db';
import { authorizeArticleRequest } from '@/server/auth/article-authorization';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { readBoundedJson } from '@/server/http/request-body';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; slideId: string }> }
) {
  try {
    assertAllowedOrigin(request);
    const { id: deckId, slideId } = await params;
    const { workspaceId } = await authorizeArticleRequest(request, deckId);
    const body = await readBoundedJson(request, 8_192);
    const validated = UpdateSlideSchema.parse(body);

    const slide = await updateSlide(workspaceId, deckId, slideId, validated);

    return NextResponse.json(slide, {
      headers: withNoStoreHeaders(),
    });
  } catch (error) {
    return errorResponse(error, {
      code: 'SLIDE_UPDATE_FAILED',
      message: 'Failed to update slide.',
      status: 400,
    });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; slideId: string }> }
) {
  try {
    assertAllowedOrigin(request);
    const { id: deckId, slideId } = await params;
    const { workspaceId } = await authorizeArticleRequest(request, deckId);

    await deleteSlide(workspaceId, deckId, slideId);

    return NextResponse.json(
      { success: true },
      {
        headers: withNoStoreHeaders(),
      }
    );
  } catch (error) {
    return errorResponse(error, {
      code: 'SLIDE_DELETE_FAILED',
      message: 'Failed to delete slide.',
      status: 500,
    });
  }
}
