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

function crossSiteRequest(): AppError {
  return new AppError({
    code: 'CROSS_SITE_REQUEST_BLOCKED',
    message: 'Cross-site requests are not allowed for this endpoint.',
    status: 403,
  });
}

function configuredOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AppError({
      code: 'INVALID_ORIGIN_CONFIGURATION',
      message: 'The trusted application origin is not configured.',
      status: 500,
    });
  }
  if (
    parsed.username || parsed.password || parsed.search || parsed.hash ||
    (parsed.pathname !== '/' && parsed.pathname !== '')
  ) {
    throw new AppError({
      code: 'INVALID_ORIGIN_CONFIGURATION',
      message: 'The trusted application origin is not configured.',
      status: 500,
    });
  }
  return parsed.origin;
}

function evidenceOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    throw crossSiteRequest();
  }
}

/**
 * Strict browser-only mutation policy for public bearer-code and owner
 * account-lifecycle endpoints. Unlike the compatibility helper above, this
 * fails closed when both Origin and Referer are absent and never trusts Host.
 */
export function assertTrustedMutationOrigin(
  request: Pick<NextRequest, 'headers'>,
  canonicalOrigin: string,
) {
  const expectedOrigin = configuredOrigin(canonicalOrigin);
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin') throw crossSiteRequest();

  const presentedOrigin = evidenceOrigin(request.headers.get('origin'))
    ?? evidenceOrigin(request.headers.get('referer'));
  if (!presentedOrigin || presentedOrigin !== expectedOrigin) throw crossSiteRequest();
}
