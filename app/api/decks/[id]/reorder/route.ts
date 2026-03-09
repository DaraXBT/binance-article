import { NextRequest, NextResponse } from 'next/server';
import { reorderSlides } from '@/lib/db';
import { z } from 'zod';

const ReorderSchema = z.object({
  slideOrder: z.array(
    z.object({
      id: z.string(),
      order: z.number(),
    })
  ),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const body = await request.json();
    const validated = ReorderSchema.parse(body);

    await reorderSlides((await params).id, validated.slideOrder);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] Error reordering slides:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to reorder slides',
      },
      { status: 400 }
    );
  }
}
