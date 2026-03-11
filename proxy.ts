import { NextResponse, type NextRequest } from 'next/server';

import { hasGrantedAppAccess, isAppAccessEnabled } from '@/lib/app-access';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname === '/access' ||
    pathname.startsWith('/api/access') ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico' ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  if (!isAppAccessEnabled() || (await hasGrantedAppAccess(request))) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL('/access', request.url));
}
