import { NextResponse, type NextRequest } from 'next/server';

import { hasGrantedAppAccess, isAppAccessEnabled } from '@/lib/app-access';

const PUBLIC_FILE_PATTERN = /\.[^/]+$/;

function isBypassedPath(pathname: string) {
  if (pathname === '/access' || pathname.startsWith('/api/access') || pathname === '/api/health') {
    return true;
  }

  if (pathname.startsWith('/_next') || pathname.startsWith('/.well-known')) {
    return true;
  }

  if (!pathname.startsWith('/api/') && PUBLIC_FILE_PATTERN.test(pathname)) {
    return true;
  }

  return false;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isBypassedPath(pathname) || !isAppAccessEnabled() || (await hasGrantedAppAccess(request))) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      {
        error: 'App access required.',
        code: 'APP_ACCESS_REQUIRED',
      },
      {
        status: 403,
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  }

  const response = NextResponse.redirect(new URL('/access', request.url));
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
