import { NextRequest, NextResponse } from 'next/server';

export const GENERATE_ACCESS_COOKIE_NAME = 'deckforge_generate_access';
const GENERATE_ACCESS_COOKIE_MAX_AGE = 60 * 60 * 12;

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

export function getConfiguredGenerateAccessCode() {
  return process.env.GENERATE_ACCESS_CODE?.trim() ?? '';
}

export function isGenerateAccessEnabled() {
  return getConfiguredGenerateAccessCode().length > 0;
}

export async function isValidGenerateAccessCode(input: string) {
  const configured = getConfiguredGenerateAccessCode();

  if (!configured) {
    return false;
  }

  return constantTimeEqual(await hashValue(input.trim()), await hashValue(configured));
}

export async function grantGenerateAccess(response: NextResponse) {
  response.cookies.set(
    GENERATE_ACCESS_COOKIE_NAME,
    await hashValue(getConfiguredGenerateAccessCode()),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: GENERATE_ACCESS_COOKIE_MAX_AGE,
      path: '/',
    }
  );
}

export async function hasGrantedGenerateAccess(request: NextRequest) {
  const configured = getConfiguredGenerateAccessCode();

  if (!configured) {
    return true;
  }

  const actual = request.cookies.get(GENERATE_ACCESS_COOKIE_NAME)?.value ?? '';
  const expected = await hashValue(configured);

  return constantTimeEqual(actual, expected);
}

export async function hasGrantedGenerateAccessFromCookie(cookieValue: string) {
  const configured = getConfiguredGenerateAccessCode();

  if (!configured) {
    return true;
  }

  const expected = await hashValue(configured);
  return constantTimeEqual(cookieValue, expected);
}

export async function checkGenerateAccessFromHeaders(request: NextRequest): Promise<boolean> {
  const configured = getConfiguredGenerateAccessCode();

  if (!configured) {
    return true;
  }

  const cookieHeader = request.headers.get('cookie') ?? '';
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${GENERATE_ACCESS_COOKIE_NAME}=([^;]*)`)
  );
  const actual = match?.[1] ?? '';
  const expected = await hashValue(configured);

  return constantTimeEqual(actual, expected);
}
