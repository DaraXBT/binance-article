import { NextRequest, NextResponse } from 'next/server';

import { createSlide } from '@/lib/db';
import { CreateSlideRequestSchema } from '@/lib/schemas';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';
import { getCurrentWorkspace } from '@/server/modules/workspace/service';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertAllowedOrigin(request);
    const { workspace } = await getCurrentWorkspace();
    const deckId = (await params).id;
    const body = await request.json();
    const validated = CreateSlideRequestSchema.parse(body);

    const slide = await createSlide(workspace.id, deckId, validated);

    return NextResponse.json(slide, { status: 201, headers: withNoStoreHeaders() });
  } catch (error) {
    return errorResponse(error, {
      code: 'SLIDE_CREATE_FAILED',
      message: 'Failed to create slide.',
      status: 400,
    });
  }
}
