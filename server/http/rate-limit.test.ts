import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    rateLimitBucket: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@/server/integrations/prisma', () => ({ default: prismaMock }));

import { checkRateLimit } from './rate-limit';

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a new bucket on the first request', async () => {
    prismaMock.rateLimitBucket.findUnique.mockResolvedValue(null);
    prismaMock.rateLimitBucket.upsert.mockResolvedValue({
      key: 'access:127.0.0.1',
      count: 1,
      resetAt: new Date(Date.now() + 60_000),
    });

    const result = await checkRateLimit('access:127.0.0.1', 5, 60_000);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(prismaMock.rateLimitBucket.upsert).toHaveBeenCalledWith({
      where: { key: 'access:127.0.0.1' },
      update: {
        count: 1,
        resetAt: expect.any(Date),
      },
      create: {
        key: 'access:127.0.0.1',
        count: 1,
        resetAt: expect.any(Date),
      },
    });
  });

  it('increments an active bucket and allows requests below the limit', async () => {
    const resetAt = new Date(Date.now() + 60_000);
    prismaMock.rateLimitBucket.findUnique.mockResolvedValue({
      count: 1,
      resetAt,
    });
    prismaMock.rateLimitBucket.update.mockResolvedValue({
      count: 2,
      resetAt,
    });

    const result = await checkRateLimit('generate:workspace-1', 5, 60_000);

    expect(result).toEqual({
      allowed: true,
      remaining: 3,
      resetAt: resetAt.getTime(),
    });
    expect(prismaMock.rateLimitBucket.update).toHaveBeenCalledWith({
      where: { key: 'generate:workspace-1' },
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
  });

  it('blocks requests after the limit is exceeded', async () => {
    const resetAt = new Date(Date.now() + 60_000);
    prismaMock.rateLimitBucket.findUnique.mockResolvedValue({
      count: 5,
      resetAt,
    });
    prismaMock.rateLimitBucket.update.mockResolvedValue({
      count: 6,
      resetAt,
    });

    const result = await checkRateLimit('recover:127.0.0.1', 5, 60_000);

    expect(result).toEqual({
      allowed: false,
      remaining: 0,
      resetAt: resetAt.getTime(),
    });
  });

  it('resets expired buckets back to a single allowed request', async () => {
    prismaMock.rateLimitBucket.findUnique.mockResolvedValue({
      count: 9,
      resetAt: new Date(Date.now() - 1_000),
    });
    prismaMock.rateLimitBucket.upsert.mockResolvedValue({
      key: 'generate-access:127.0.0.1',
      count: 1,
      resetAt: new Date(Date.now() + 60_000),
    });

    const result = await checkRateLimit('generate-access:127.0.0.1', 5, 60_000);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(prismaMock.rateLimitBucket.upsert).toHaveBeenCalledTimes(1);
  });
});
