import { NextRequest, NextResponse } from 'next/server';

import { assertAllowedOrigin } from '@/server/auth/origin';
import { withNoStoreHeaders } from '@/server/http/errors';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  assertAllowedOrigin(request);
  await params;

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
}
