import { NextRequest } from 'next/server';

import { AppError } from '@/server/http/errors';

function getRequestOrigin(request: NextRequest) {
  const originHeader = request.headers.get('origin');

  if (!originHeader) {
    return null;
  }

  try {
    return new URL(originHeader).origin;
  } catch {
    throw new AppError({
      code: 'INVALID_ORIGIN',
      message: 'The request origin header is invalid.',
      status: 403,
    });
  }
}

export function assertAllowedOrigin(request: NextRequest) {
  const requestOrigin = getRequestOrigin(request);

  if (!requestOrigin) {
    return;
  }

  const urlOrigin = request.nextUrl.origin;

  if (requestOrigin !== urlOrigin) {
    throw new AppError({
      code: 'CROSS_SITE_REQUEST_BLOCKED',
      message: 'Cross-site requests are not allowed for this endpoint.',
      status: 403,
    });
  }
}
