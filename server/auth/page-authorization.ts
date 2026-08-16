import { getSessionCookie } from 'better-auth/cookies';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { normalizeLoginCallback } from '@/lib/auth-return-to';
import { isAppError } from '@/server/http/errors';

import { hasUsableAuthEnvironment } from './auth-policy';
import { requireActiveUser } from './authorization';

export { normalizeLoginCallback } from '@/lib/auth-return-to';

async function authorizePageRequest(path: string, requestHeaders?: Headers) {
  const resolvedHeaders = requestHeaders ?? await headers();
  return requireActiveUser(new Request(new URL(path, 'https://app.invalid'), {
    headers: resolvedHeaders,
  }));
}

export async function getOptionalActivePageUser() {
  const requestHeaders = await headers();
  // The public home is anonymous by default. Avoid constructing Better Auth
  // (and therefore validating auth/database environment variables) when the
  // browser has no session token to validate. A present token still goes
  // through the full server-side session and account-status checks below.
  if (
    !hasUsableAuthEnvironment(process.env) ||
    !getSessionCookie(requestHeaders)
  ) return null;

  try {
    return await authorizePageRequest('/', requestHeaders);
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
