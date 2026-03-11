import { NextRequest, NextResponse } from 'next/server';
import { reorderSlides } from '@/lib/db';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { getCurrentWorkspace } from '@/server/modules/workspace/service';
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
    assertAllowedOrigin(request);
    const { workspace } = await getCurrentWorkspace();
    const body = await request.json();
    const validated = ReorderSchema.parse(body);
    const deckId = (await params).id;

    await reorderSlides(workspace.id, deckId, validated.slideOrder);

    return NextResponse.json(
      { success: true },
      {
        headers: withNoStoreHeaders(),
      }
    );
  } catch (error) {
    return errorResponse(error, {
      code: 'SLIDE_REORDER_FAILED',
      message: 'Failed to reorder slides.',
      status: 400,
    });
  }
}
