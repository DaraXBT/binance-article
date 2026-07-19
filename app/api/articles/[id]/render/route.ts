import { NextRequest, NextResponse } from 'next/server';

import { authorizeArticleRequest } from '@/server/auth/article-authorization';
import { assertAllowedOrigin } from '@/server/auth/origin';
import { errorResponse, withNoStoreHeaders } from '@/server/http/errors';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertAllowedOrigin(request);
    const deckId = (await params).id;
    await authorizeArticleRequest(request, deckId);

    return NextResponse.json(
      {
        error: 'Render export is disabled until the production renderer is implemented.',
        code: 'RENDER_NOT_AVAILABLE',
      },
      {
        status: 501,
        headers: withNoStoreHeaders(),
      }
    );
  } catch (error) {
    return errorResponse(error, {
      code: 'RENDER_AUTHORIZATION_FAILED',
      message: 'The render request could not be authorized.',
      status: 500,
    });
  }
}
