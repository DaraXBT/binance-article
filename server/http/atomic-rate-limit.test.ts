import { describe, expect, it, vi } from 'vitest';

import { consumeAtomicRateLimit } from './atomic-rate-limit';

describe('Neon atomic rate limiter', () => {
  it('increments or resets one bucket in a single bounded upsert', async () => {
    const captured: Array<{ text: string; values: unknown[] }> = [];
    const resetAt = new Date('2026-07-19T00:15:00.000Z');
    const client = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      captured.push({ text: strings.join('?'), values });
      return [{ count: 2, resetAt }];
    });
    const result = await consumeAtomicRateLimit({
      database: { $client: client } as never,
      key: 'legacy-workspace-claim:user_1',
      limit: 5,
      windowMs: 15 * 60 * 1_000,
      now: new Date('2026-07-19T00:00:00.000Z'),
    });

    expect(result).toEqual({ allowed: true, remaining: 3, resetAt });
    expect(client).toHaveBeenCalledTimes(1);
    expect(captured[0]?.text).toMatch(/INSERT INTO "RateLimitBucket"/);
    expect(captured[0]?.text).toMatch(/ON CONFLICT \("key"\) DO UPDATE/);
    expect(captured[0]?.text).toMatch(/LEAST[\s\S]*"count" \+ 1/);
    expect(captured[0]?.text).toMatch(/RETURNING "count", "resetAt"/);
    expect(captured[0]?.values).toContain('legacy-workspace-claim:user_1');
  });

  it('returns a stable block after the bounded counter crosses the limit', async () => {
    const resetAt = new Date('2026-07-19T00:15:00.000Z');
    const client = vi.fn(async () => [{ count: 6, resetAt }]);
    await expect(consumeAtomicRateLimit({
      database: { $client: client } as never,
      key: 'legacy-workspace-claim:user_1',
      limit: 5,
      windowMs: 900_000,
      now: new Date('2026-07-19T00:00:00.000Z'),
    })).resolves.toEqual({ allowed: false, remaining: 0, resetAt });
  });
});
