import { NextResponse } from 'next/server';

import type { AppDatabase } from '@/server/db/client';

import { consumeAtomicRateLimit } from './atomic-rate-limit';
import { withNoStoreHeaders } from './errors';

const OWNER_MUTATION_WINDOW_MS = 10 * 60 * 1_000;

const OWNER_MUTATION_LIMITS = {
  enrollment_code: 6,
  people_status: 30,
} as const;

export type OwnerMutationScope = keyof typeof OWNER_MUTATION_LIMITS;

export async function ownerMutationRateLimit(input: {
  database: AppDatabase;
  ownerUserId: string;
  scope: OwnerMutationScope;
  now?: Date;
}): Promise<NextResponse | null> {
  const now = input.now ?? new Date();
  const result = await consumeAtomicRateLimit({
    database: input.database,
    key: `owner-mutation:${input.scope}:${input.ownerUserId}`,
    limit: OWNER_MUTATION_LIMITS[input.scope],
    windowMs: OWNER_MUTATION_WINDOW_MS,
    now,
  });
  if (result.allowed) return null;

  return NextResponse.json({
    error: 'Too many access changes. Try again shortly.',
    code: 'OWNER_MUTATION_RATE_LIMITED',
  }, {
    status: 429,
    headers: {
      ...withNoStoreHeaders({ 'Referrer-Policy': 'no-referrer' }),
      'Retry-After': String(Math.max(
        1,
        Math.ceil((result.resetAt.getTime() - now.getTime()) / 1_000),
      )),
    },
  });
}
