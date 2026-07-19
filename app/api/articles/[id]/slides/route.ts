import { NextRequest, NextResponse } from 'next/server';

import { createSlide } from '@/lib/db';
import { CreateSlideRequestSchema } from '@/lib/schemas';
import { authorizeArticleRequest } from '@/server/auth/article-authorization';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { readBoundedJson } from '@/server/http/request-body';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertAllowedOrigin(request);
    const deckId = (await params).id;
    const { workspaceId } = await authorizeArticleRequest(request, deckId);
    const body = await readBoundedJson(request, 8_192);
    const validated = CreateSlideRequestSchema.parse(body);

    const slide = await createSlide(workspaceId, deckId, validated);

    return NextResponse.json(slide, { status: 201, headers: withNoStoreHeaders() });
  } catch (error) {
    return errorResponse(error, {
      code: 'SLIDE_CREATE_FAILED',
      message: 'Failed to create slide.',
      status: 400,
    });
  }
}
