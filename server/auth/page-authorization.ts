import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { isAppError } from '@/server/http/errors';

import { requireActiveUser } from './authorization';

const DEFAULT_AUTHENTICATED_DESTINATION = '/workspace';

export function normalizeLoginCallback(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 500) {
    return DEFAULT_AUTHENTICATED_DESTINATION;
  }
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) {
    return DEFAULT_AUTHENTICATED_DESTINATION;
  }
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(decoded)) {
      return DEFAULT_AUTHENTICATED_DESTINATION;
    }
    const parsed = new URL(value, 'https://app.invalid');
    if (parsed.origin !== 'https://app.invalid') return DEFAULT_AUTHENTICATED_DESTINATION;
    // WHATWG URL parsing resolves dot segments. Validate the normalized path
    // as well as the raw value so `/foo/..//evil.example` cannot become a
    // scheme-relative OAuth callback after normalization.
    if (
      !parsed.pathname.startsWith('/') ||
      parsed.pathname.startsWith('//') ||
      /[\\\u0000-\u001f\u007f]/.test(parsed.pathname)
    ) {
      return DEFAULT_AUTHENTICATED_DESTINATION;
    }
    if (
      parsed.pathname === '/login' ||
      parsed.pathname.startsWith('/login/') ||
      parsed.pathname === '/join' ||
      parsed.pathname.startsWith('/join/')
    ) {
      return DEFAULT_AUTHENTICATED_DESTINATION;
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return DEFAULT_AUTHENTICATED_DESTINATION;
  }
}

async function authorizePageRequest(path: string) {
  const requestHeaders = await headers();
  return requireActiveUser(new Request(new URL(path, 'https://app.invalid'), {
    headers: requestHeaders,
  }));
}

export async function getOptionalActivePageUser() {
  try {
    return await authorizePageRequest('/');
  } catch (error) {
    if (isAppError(error) && error.code === 'AUTH_REQUIRED') return null;
    if (isAppError(error) && error.code === 'ACCOUNT_DISABLED') {
      redirect('/login?error=account_disabled');
    }
    throw error;
  }
}

export async function requireActivePageUser(callbackURL: string) {
  const safeCallback = normalizeLoginCallback(callbackURL);
  try {
    return await authorizePageRequest(safeCallback);
  } catch (error) {
    if (isAppError(error) && error.code === 'AUTH_REQUIRED') {
      redirect(`/login?callbackURL=${encodeURIComponent(safeCallback)}`);
    }
    if (isAppError(error) && error.code === 'ACCOUNT_DISABLED') {
      redirect('/login?error=account_disabled');
    }
    throw error;
  }
}
