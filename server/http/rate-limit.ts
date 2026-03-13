import prisma from '@/server/integrations/prisma';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Shared rate limiter backed by Prisma.
 *
 * @param key      Unique identifier (e.g. "access:1.2.3.4")
 * @param limit    Maximum number of requests in the window
 * @param windowMs Window duration in milliseconds
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const now = Date.now();
  const resetAt = new Date(now + windowMs);
  const bucket = await prisma.rateLimitBucket.findUnique({
    where: { key },
    select: {
      count: true,
      resetAt: true,
    },
  });

  if (!bucket || bucket.resetAt.getTime() <= now) {
    await prisma.rateLimitBucket.upsert({
      where: { key },
      update: {
        count: 1,
        resetAt,
      },
      create: {
        key,
        count: 1,
        resetAt,
      },
    });

    return { allowed: true, remaining: Math.max(limit - 1, 0), resetAt: resetAt.getTime() };
  }

  const updatedBucket = await prisma.rateLimitBucket.update({
    where: { key },
    data: {
      count: {
        increment: 1,
      },
    },
    select: {
      count: true,
      resetAt: true,
    },
  });

  if (updatedBucket.count > limit) {
    return { allowed: false, remaining: 0, resetAt: updatedBucket.resetAt.getTime() };
  }

  return {
    allowed: true,
    remaining: Math.max(limit - updatedBucket.count, 0),
    resetAt: updatedBucket.resetAt.getTime(),
  };
}
