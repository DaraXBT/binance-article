import type { AppDatabase } from '@/server/db/client';

export interface AtomicRateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

export async function consumeAtomicRateLimit(input: {
  database: AppDatabase;
  key: string;
  limit: number;
  windowMs: number;
  now?: Date;
}): Promise<AtomicRateLimitResult> {
  const key = input.key.trim();
  if (!key || key.length > 200) throw new Error('Rate-limit key is invalid.');
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100_000) {
    throw new Error('Rate-limit maximum is invalid.');
  }
  if (!Number.isSafeInteger(input.windowMs) || input.windowMs < 1_000 || input.windowMs > 86_400_000) {
    throw new Error('Rate-limit window is invalid.');
  }
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('Rate-limit timestamp is invalid.');
  const nextResetAt = new Date(now.getTime() + input.windowMs);
  const boundedCount = input.limit + 1;

  const rows = await input.database.$client`
    INSERT INTO "RateLimitBucket" (
      "key", "count", "resetAt", "createdAt", "updatedAt"
    ) VALUES (
      ${key}, 1, ${nextResetAt}, ${now}, ${now}
    )
    ON CONFLICT ("key") DO UPDATE
    SET
      "count" = CASE
        WHEN "RateLimitBucket"."resetAt" <= ${now} THEN 1
        ELSE LEAST("RateLimitBucket"."count" + 1, ${boundedCount})
      END,
      "resetAt" = CASE
        WHEN "RateLimitBucket"."resetAt" <= ${now} THEN ${nextResetAt}
        ELSE "RateLimitBucket"."resetAt"
      END,
      "updatedAt" = ${now}
    RETURNING "count", "resetAt"
  `;
  const row = (rows as Array<{ count?: unknown; resetAt?: unknown }>)[0];
  const count = Number(row?.count);
  const resetAt = row?.resetAt instanceof Date ? row.resetAt : new Date(String(row?.resetAt ?? ''));
  if (!Number.isSafeInteger(count) || count < 1 || !Number.isFinite(resetAt.getTime())) {
    throw new Error('Rate-limit update failed.');
  }

  return {
    allowed: count <= input.limit,
    remaining: Math.max(input.limit - count, 0),
    resetAt,
  };
}
