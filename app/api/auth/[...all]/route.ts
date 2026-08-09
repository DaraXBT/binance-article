import { toNextJsHandler } from 'better-auth/next-js';

import { parseAuthEnvironment } from '@/server/auth/auth-policy';
import { getRuntimeAuth } from '@/server/auth/runtime';
import { getRuntimeDatabase } from '@/server/db/runtime';
import { consumeAtomicRateLimit } from '@/server/http/atomic-rate-limit';

const OAUTH_CALLBACK_LIMIT = 20;
const OAUTH_CALLBACK_WINDOW_MS = 10 * 60 * 1_000;

let handlers: ReturnType<typeof toNextJsHandler> | undefined;

function getHandlers() {
  handlers ??= toNextJsHandler(getRuntimeAuth());
  return handlers;
}

async function callbackFingerprint(request: Request): Promise<string> {
  const identity = request.headers.get('cf-connecting-ip')?.trim().slice(0, 100) || 'unknown';
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`xarticle:oauth-callback-rate-limit:v1:${identity}`),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function callbackRateLimitResponse(request: Request): Promise<Response | null> {
  let pathname: string;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return null;
  }
  if (!pathname.endsWith('/api/auth/callback/google')) return null;

  const now = new Date();
  const result = await consumeAtomicRateLimit({
    database: getRuntimeDatabase(),
    key: `oauth-callback:${await callbackFingerprint(request)}`,
    limit: OAUTH_CALLBACK_LIMIT,
    windowMs: OAUTH_CALLBACK_WINDOW_MS,
    now,
  });
  if (result.allowed) return null;

  const environment = parseAuthEnvironment(process.env);
  const location = new URL('/auth/error', environment.baseUrl);
  location.searchParams.set('error', 'oauth_rate_limited');
  return new Response(null, {
    status: 302,
    headers: {
      Location: location.toString(),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Retry-After': String(Math.max(1, Math.ceil(
        (result.resetAt.getTime() - now.getTime()) / 1_000,
      ))),
    },
  });
}

export async function GET(request: Request) {
  const rateLimited = await callbackRateLimitResponse(request);
  if (rateLimited) return rateLimited;
  return getHandlers().GET(request);
}

export function POST(request: Request) {
  return getHandlers().POST(request);
}
