import { NextRequest, NextResponse } from 'next/server';
import { UpdateSlideSchema } from '@/lib/schemas';
import { updateSlide, deleteSlide } from '@/lib/db';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { getCurrentWorkspace } from '@/server/modules/workspace/service';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; slideId: string }> }
) {
  try {
    assertAllowedOrigin(request);
    const { workspace } = await getCurrentWorkspace();
    const { id: deckId, slideId } = await params;
    const body = await request.json();
    const validated = UpdateSlideSchema.parse(body);

    const slide = await updateSlide(workspace.id, deckId, slideId, validated);

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
    const { workspace } = await getCurrentWorkspace();
    const { id: deckId, slideId } = await params;

    await deleteSlide(workspace.id, deckId, slideId);

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
