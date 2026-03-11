import { NextRequest, NextResponse } from 'next/server';

export const APP_ACCESS_COOKIE_NAME = 'deckforge_app_access';
const APP_ACCESS_COOKIE_MAX_AGE = 60 * 60 * 12;

async function hashValue(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}

export function getConfiguredAppAccessCode() {
  return process.env.APP_ACCESS_CODE?.trim() ?? '';
}

export function isAppAccessEnabled() {
  return getConfiguredAppAccessCode().length > 0;
}

export async function isValidAppAccessCode(input: string) {
  const configured = getConfiguredAppAccessCode();

  if (!configured) {
    return false;
  }

  return constantTimeEqual(await hashValue(input.trim()), await hashValue(configured));
}

export async function grantAppAccess(response: NextResponse) {
  response.cookies.set(APP_ACCESS_COOKIE_NAME, await hashValue(getConfiguredAppAccessCode()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: APP_ACCESS_COOKIE_MAX_AGE,
    path: '/',
  });
}

export async function hasGrantedAppAccess(request: NextRequest) {
  const configured = getConfiguredAppAccessCode();

  if (!configured) {
    return true;
  }

  const actual = request.cookies.get(APP_ACCESS_COOKIE_NAME)?.value ?? '';
  const expected = await hashValue(configured);

  return constantTimeEqual(actual, expected);
}

export async function createGrantedAppAccessCookieValue() {
  return hashValue(getConfiguredAppAccessCode());
}
