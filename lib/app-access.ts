import { NextRequest, NextResponse } from 'next/server';

export const APP_ACCESS_COOKIE_NAME = 'deckforge_app_access';

async function hashValue(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function getConfiguredAppAccessCode() {
  return process.env.APP_ACCESS_CODE?.trim() ?? '';
}

export function isAppAccessEnabled() {
  return getConfiguredAppAccessCode().length > 0;
}

export function isValidAppAccessCode(input: string) {
  const configured = getConfiguredAppAccessCode();
  return configured.length > 0 && input.trim() === configured;
}

export async function grantAppAccess(response: NextResponse) {
  response.cookies.set(APP_ACCESS_COOKIE_NAME, await hashValue(getConfiguredAppAccessCode()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

export async function hasGrantedAppAccess(request: NextRequest) {
  const configured = getConfiguredAppAccessCode();

  if (!configured) {
    return true;
  }

  return request.cookies.get(APP_ACCESS_COOKIE_NAME)?.value === (await hashValue(configured));
}

export async function createGrantedAppAccessCookieValue() {
  return hashValue(getConfiguredAppAccessCode());
}
