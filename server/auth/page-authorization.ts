import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { isAppError } from '@/server/http/errors';

import { requireActiveUser } from './authorization';

export function normalizeLoginCallback(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 500) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) return '/';
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith('//') || decoded.includes('\\')) return '/';
    const parsed = new URL(value, 'https://app.invalid');
    if (parsed.origin !== 'https://app.invalid') return '/';
    if (parsed.pathname === '/login' || parsed.pathname === '/join') return '/';
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return '/';
  }
}

export async function requireActivePageUser(callbackURL: string) {
  const safeCallback = normalizeLoginCallback(callbackURL);
  const requestHeaders = await headers();
  try {
    return await requireActiveUser(new Request(new URL(safeCallback, 'https://app.invalid'), {
      headers: requestHeaders,
    }));
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
