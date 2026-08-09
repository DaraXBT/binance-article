import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertTrustedMutationOrigin: vi.fn(),
  parseAuthEnvironment: vi.fn(() => ({ baseUrl: 'https://articles.example.com', secureCookies: true })),
  getRuntimeDatabase: vi.fn(() => ({ database: true })),
  createRepository: vi.fn(() => ({ repository: true })),
  consumeAtomicRateLimit: vi.fn(async (_input: unknown) => ({
    allowed: true, remaining: 9, resetAt: new Date(Date.now() + 600_000),
  })),
  claimLegacyInvitation: vi.fn(async () => ({
    claimId: 'claim_1', claimToken: 'A'.repeat(43), status: 'pending' as const,
    email: 'invited@example.com', expiresAt: new Date('2026-08-09T00:15:00.000Z'),
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
  createEnrollmentRepository: mocks.createRepository,
}));
vi.mock('@/server/modules/enrollment/service', () => ({
  claimLegacyInvitation: mocks.claimLegacyInvitation,
}));

describe('POST /api/invitations/accept', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exchanges a legacy token for the shared durable claim cookie', async () => {
    const { POST } = await import('./route');
    const token = 'invite_token_value_12345678901234567890';
    const request = new Request('https://articles.example.com/api/invitations/accept', {
      method: 'POST',
      headers: { origin: 'https://articles.example.com', 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const response = await POST(request as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.claimLegacyInvitation).toHaveBeenCalledWith({
      repository: { repository: true }, invitationToken: token,
    });
    expect(mocks.consumeAtomicRateLimit).toHaveBeenCalledTimes(2);
    expect(response.headers.get('set-cookie')).toMatch(
      /xarticle_enrollment_claim=A{43}.*Path=\/api.*HttpOnly.*Secure/i,
    );
    expect(body).toEqual({
      success: true,
      email: 'invited@example.com',
      expiresAt: '2026-08-09T00:15:00.000Z',
    });
    expect(JSON.stringify(body)).not.toContain(token);
  });

  it('returns one generic legacy error for invalid or expired tokens', async () => {
    mocks.claimLegacyInvitation.mockRejectedValueOnce(Object.assign(new Error('invalid'), {
      code: 'INVALID_INVITATION', status: 400,
    }));
    const { POST } = await import('./route');
    const response = await POST(new Request('https://articles.example.com/api/invitations/accept', {
      method: 'POST',
      body: JSON.stringify({ token: 'bad' }),
    }) as never);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'INVITATION_ACCEPT_FAILED' });
  });

  it('enforces the per-token bucket without storing or returning the bearer token', async () => {
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
    const token = 'invite_token_value_12345678901234567890';
    const response = await POST(new Request('https://articles.example.com/api/invitations/accept', {
      method: 'POST',
      headers: { origin: 'https://articles.example.com', 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    }) as never);
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(mocks.consumeAtomicRateLimit).toHaveBeenCalledTimes(2);
    const tokenBucket = mocks.consumeAtomicRateLimit.mock.calls[1]![0] as {
      key: string;
      limit: number;
      windowMs: number;
    };
    expect(tokenBucket).toMatchObject({ limit: 20, windowMs: 10 * 60 * 1_000 });
    expect(tokenBucket.key).toMatch(/^legacy-invitation-token:[a-f0-9]{64}$/);
    expect(tokenBucket.key).not.toContain(token);
    expect(response.headers.get('retry-after')).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain(token);
    expect(mocks.claimLegacyInvitation).not.toHaveBeenCalled();
  });
});
