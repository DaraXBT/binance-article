import { NextRequest, NextResponse } from 'next/server';

import { createSlide } from '@/lib/db';
import { CreateSlideRequestSchema } from '@/lib/schemas';
import { getCurrentWorkspace } from '@/lib/workspace';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspace } = await getCurrentWorkspace();
    const deckId = (await params).id;
    const body = await request.json();
    const validated = CreateSlideRequestSchema.parse(body);

    const slide = await createSlide(workspace.id, deckId, validated);

    return NextResponse.json(slide, { status: 201 });
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return NextResponse.json({ error: 'Deck not found' }, { status: 404 });
    }

    console.error('[API] Error creating slide:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to create slide',
      },
      { status: 400 }
    );
  }
}
