import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertTrustedMutationOrigin: vi.fn(),
  parseAuthEnvironment: vi.fn(() => ({
    baseUrl: 'https://articles.example.com',
    secureCookies: true,
  })),
  getRuntimeDatabase: vi.fn(() => ({ database: true })),
  createEnrollmentRepository: vi.fn(() => ({ repository: true })),
  consumeAtomicRateLimit: vi.fn(async (_input: unknown) => ({
    allowed: true, remaining: 9, resetAt: new Date('2026-08-09T00:10:00.000Z'),
  })),
  getEnrollmentCodePepper: vi.fn(() => 'p'.repeat(48)),
  claimEnrollmentCode: vi.fn(async () => ({
    claimId: 'claim_1',
    claimToken: 'A'.repeat(43),
    status: 'pending' as const,
    expiresAt: new Date('2026-08-09T00:15:00.000Z'),
  })),
}));

vi.mock('@/server/auth/auth-policy', () => ({ parseAuthEnvironment: mocks.parseAuthEnvironment }));
vi.mock('@/server/auth/origin', () => ({
  assertTrustedMutationOrigin: mocks.assertTrustedMutationOrigin,
}));
vi.mock('@/server/db/runtime', () => ({ getRuntimeDatabase: mocks.getRuntimeDatabase }));
vi.mock('@/server/http/atomic-rate-limit', () => ({
  consumeAtomicRateLimit: mocks.consumeAtomicRateLimit,
}));
vi.mock('@/server/modules/enrollment/repository', () => ({
  createEnrollmentRepository: mocks.createEnrollmentRepository,
}));
vi.mock('@/server/modules/enrollment/service', () => ({
  getEnrollmentCodePepper: mocks.getEnrollmentCodePepper,
  claimEnrollmentCode: mocks.claimEnrollmentCode,
}));

describe('POST /api/enrollment/claim', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exchanges a shared code for a short-lived HttpOnly claim', async () => {
    const { POST } = await import('./route');
    const rawCode = 'JOIN-01234-56789-ABCDE-FGHJK';
    const request = new Request('https://articles.example.com/api/enrollment/claim', {
      method: 'POST',
      headers: {
        origin: 'https://articles.example.com',
        'content-type': 'application/json',
        'idempotency-key': 'attempt-12345678',
      },
      body: JSON.stringify({ code: rawCode, idempotencyKey: 'attempt-12345678' }),
    });

    const response = await POST(request as never);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(mocks.assertTrustedMutationOrigin).toHaveBeenCalledWith(
      request,
      'https://articles.example.com',
    );
    expect(mocks.claimEnrollmentCode).toHaveBeenCalledWith({
      repository: { repository: true },
      code: rawCode,
      idempotencyKey: 'attempt-12345678',
      pepper: 'p'.repeat(48),
    });
    expect(mocks.consumeAtomicRateLimit).toHaveBeenCalledTimes(2);
    expect(mocks.consumeAtomicRateLimit).toHaveBeenCalledWith(expect.objectContaining({
      limit: 10,
      windowMs: 10 * 60 * 1_000,
    }));
    expect(body).toEqual({
      claim: { status: 'pending', expiresAt: '2026-08-09T00:15:00.000Z' },
    });
    expect(JSON.stringify(body)).not.toContain(rawCode);
    expect(response.headers.get('set-cookie')).toMatch(
      /xarticle_enrollment_claim=A{43}.*Max-Age=900.*Path=\/api.*HttpOnly.*Secure/i,
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('rejects ambiguous idempotency keys before touching persistence', async () => {
    const { POST } = await import('./route');
    const response = await POST(new Request('https://articles.example.com/api/enrollment/claim', {
      method: 'POST',
      headers: {
        origin: 'https://articles.example.com',
        'content-type': 'application/json',
        'idempotency-key': 'header-key-12345',
      },
      body: JSON.stringify({
        code: 'JOIN-01234-56789-ABCDE-FGHJK',
        idempotencyKey: 'body-key-1234567',
      }),
    }) as never);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'INVALID_IDEMPOTENCY_KEY' });
    expect(mocks.claimEnrollmentCode).not.toHaveBeenCalled();
  });

  it('adds Retry-After to throttled responses without exposing claim details', async () => {
    mocks.consumeAtomicRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + 60_000),
    });
    const { POST } = await import('./route');
    const response = await POST(new Request('https://articles.example.com/api/enrollment/claim', {
      method: 'POST',
      headers: {
        origin: 'https://articles.example.com',
        'content-type': 'application/json',
        'idempotency-key': 'attempt-12345678',
      },
      body: JSON.stringify({
        code: 'JOIN-01234-56789-ABCDE-FGHJK',
        idempotencyKey: 'attempt-12345678',
      }),
    }) as never);

    expect(response.status).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await response.json()).toMatchObject({ code: 'ENROLLMENT_RATE_LIMITED' });
    expect(mocks.claimEnrollmentCode).not.toHaveBeenCalled();
  });

  it('charges and enforces the per-code bucket after the IP bucket allows the request', async () => {
    mocks.consumeAtomicRateLimit
      .mockResolvedValueOnce({
        allowed: true,
        remaining: 9,
        resetAt: new Date(Date.now() + 60_000),
      })
      .mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        resetAt: new Date(Date.now() + 60_000),
      });
    const { POST } = await import('./route');
    const rawCode = 'JOIN-01234-56789-ABCDE-FGHJK';
    const response = await POST(new Request('https://articles.example.com/api/enrollment/claim', {
      method: 'POST',
      headers: {
        origin: 'https://articles.example.com',
        'content-type': 'application/json',
        'idempotency-key': 'attempt-12345678',
      },
      body: JSON.stringify({ code: rawCode, idempotencyKey: 'attempt-12345678' }),
    }) as never);

    expect(response.status).toBe(429);
    expect(mocks.consumeAtomicRateLimit).toHaveBeenCalledTimes(2);
    const codeBucket = mocks.consumeAtomicRateLimit.mock.calls[1]![0] as {
      key: string;
      limit: number;
      windowMs: number;
    };
    expect(codeBucket).toMatchObject({ limit: 20, windowMs: 10 * 60 * 1_000 });
    expect(codeBucket.key).toMatch(/^enrollment-code:[a-f0-9]{64}$/);
    expect(codeBucket.key).not.toContain(rawCode);
    expect(mocks.claimEnrollmentCode).not.toHaveBeenCalled();
  });
});
