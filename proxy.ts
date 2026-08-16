import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { evaluateCutoverMaintenance } from '@/server/http/cutover-maintenance';

const MAINTENANCE_MESSAGE = 'Scheduled maintenance is in progress. Please try again shortly.';
const MAINTENANCE_HEADERS = {
  'Cache-Control': 'no-store',
  'Retry-After': '120',
  'X-Robots-Tag': 'noindex, nofollow',
};

export function proxy(request: NextRequest) {
  const decision = evaluateCutoverMaintenance({
    mode: process.env.CUTOVER_MAINTENANCE_MODE,
    allowedIps: process.env.CUTOVER_MAINTENANCE_ALLOW_IPS,
    connectingIp: request.headers.get('cf-connecting-ip') ?? undefined,
  });

  if (!decision.blocked) return NextResponse.next();

  const wantsJson = request.nextUrl.pathname.startsWith('/api/')
    || request.headers.get('accept')?.includes('application/json');
  if (wantsJson) {
    return NextResponse.json(
      { error: MAINTENANCE_MESSAGE },
      { status: 503, headers: MAINTENANCE_HEADERS },
    );
  }

  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scheduled maintenance</title></head><body><main><h1>We\u2019ll be right back</h1><p>${MAINTENANCE_MESSAGE}</p></main></body></html>`,
    {
      status: 503,
      headers: {
        ...MAINTENANCE_HEADERS,
        'Content-Type': 'text/html; charset=utf-8',
      },
    },
  );
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
