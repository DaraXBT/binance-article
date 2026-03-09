import { NextRequest, NextResponse } from 'next/server';
import { UpdateSlideSchema } from '@/lib/schemas';
import { updateSlide, deleteSlide } from '@/lib/db';
import { getCurrentWorkspace } from '@/lib/workspace';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; slideId: string }> }
) {
  try {
    const { workspace } = await getCurrentWorkspace();
    const { id: deckId, slideId } = await params;
    const body = await request.json();
    const validated = UpdateSlideSchema.parse(body);

    const slide = await updateSlide(workspace.id, deckId, slideId, validated);

    return NextResponse.json(slide);
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return NextResponse.json({ error: 'Slide not found' }, { status: 404 });
    }

    console.error('[API] Error updating slide:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to update slide',
      },
      { status: 400 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; slideId: string }> }
) {
  try {
    const { workspace } = await getCurrentWorkspace();
    const { id: deckId, slideId } = await params;

    await deleteSlide(workspace.id, deckId, slideId);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return NextResponse.json({ error: 'Slide not found' }, { status: 404 });
    }

    console.error('[API] Error deleting slide:', error);
    return NextResponse.json(
      {
        error: 'Failed to delete slide',
      },
      { status: 500 }
    );
  }
}
