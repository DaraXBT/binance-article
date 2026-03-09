import { NextRequest, NextResponse } from 'next/server';
import { reorderSlides } from '@/lib/db';
import { getCurrentWorkspace } from '@/lib/workspace';
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
    const { workspace } = await getCurrentWorkspace();
    const body = await request.json();
    const validated = ReorderSchema.parse(body);
    const deckId = (await params).id;

    await reorderSlides(workspace.id, deckId, validated.slideOrder);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return NextResponse.json({ error: 'Deck not found' }, { status: 404 });
    }

    console.error('[API] Error reordering slides:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to reorder slides',
      },
      { status: 400 }
    );
  }
}
