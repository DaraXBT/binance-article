import { NextRequest, NextResponse } from 'next/server';
import { UpdateSlideSchema } from '@/lib/schemas';
import { updateSlide, deleteSlide } from '@/lib/db';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; slideId: string } }
) {
  try {
    const { slideId } = params;
    const body = await request.json();
    const validated = UpdateSlideSchema.parse(body);

    const slide = await updateSlide(slideId, validated);

    return NextResponse.json(slide);
  } catch (error) {
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
  { params }: { params: { id: string; slideId: string } }
) {
  try {
    const { slideId } = params;

    await deleteSlide(slideId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] Error deleting slide:', error);
    return NextResponse.json(
      {
        error: 'Failed to delete slide',
      },
      { status: 500 }
    );
  }
}
