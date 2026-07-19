import { NextRequest, NextResponse } from 'next/server';
import { reorderSlides } from '@/lib/db';
import { authorizeArticleRequest } from '@/server/auth/article-authorization';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { readBoundedJson } from '@/server/http/request-body';
import { z } from 'zod';

const ReorderSchema = z.object({
  slideOrder: z.array(
    z.object({
      id: z.string().trim().min(1).max(200),
      order: z.number().int().min(0).max(9),
    })
  ).min(1).max(10),
}).strict();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertAllowedOrigin(request);
    const deckId = (await params).id;
    const { workspaceId } = await authorizeArticleRequest(request, deckId);
    const body = await readBoundedJson(request, 4_096);
    const validated = ReorderSchema.parse(body);

    await reorderSlides(workspaceId, deckId, validated.slideOrder);

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
