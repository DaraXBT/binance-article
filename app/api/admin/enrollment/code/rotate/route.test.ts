import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireActiveUser: vi.fn(async () => ({ id: 'owner_1', role: 'owner' })),
  assertTrustedMutationOrigin: vi.fn(),
  parseAuthEnvironment: vi.fn(() => ({ baseUrl: 'https://articles.example.com', secureCookies: true })),
  getRuntimeDatabase: vi.fn(() => ({ database: true })),
  createRepository: vi.fn(() => ({ repository: true })),
  consumeAtomicRateLimit: vi.fn(async () => ({
    allowed: true, remaining: 4, resetAt: new Date(Date.now() + 60_000),
  })),
  getEnrollmentCodePepper: vi.fn(() => 'p'.repeat(48)),
  rotateEnrollmentCode: vi.fn(async () => ({
    code: 'JOIN-12345-6789A-BCDEF-GHJKM', codePrefix: '12345678', version: 2,
    revokedCodeId: 'code_1', revokedClaims: 3,
  })),
}));

vi.mock('@/server/auth/authorization', () => ({ requireActiveUser: mocks.requireActiveUser }));
vi.mock('@/server/auth/origin', () => ({ assertTrustedMutationOrigin: mocks.assertTrustedMutationOrigin }));
vi.mock('@/server/auth/auth-policy', () => ({ parseAuthEnvironment: mocks.parseAuthEnvironment }));
vi.mock('@/server/db/runtime', () => ({ getRuntimeDatabase: mocks.getRuntimeDatabase }));
vi.mock('@/server/http/atomic-rate-limit', () => ({
  consumeAtomicRateLimit: mocks.consumeAtomicRateLimit,
}));
vi.mock('@/server/modules/enrollment/repository', () => ({ createEnrollmentRepository: mocks.createRepository }));
vi.mock('@/server/modules/enrollment/service', () => ({
  getEnrollmentCodePepper: mocks.getEnrollmentCodePepper,
  rotateEnrollmentCode: mocks.rotateEnrollmentCode,
}));

describe('POST /api/admin/enrollment/code/rotate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rotates the code, invalidates unfinished claims, and returns the new secret once', async () => {
    const { POST } = await import('./route');
    const request = new Request('https://poisoned.example/api/admin/enrollment/code/rotate', {
      method: 'POST',
      headers: { origin: 'https://articles.example.com', 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'owner_rotation' }),
    });
    const response = await POST(request as never);

    expect(response.status).toBe(200);
    expect(mocks.rotateEnrollmentCode).toHaveBeenCalledWith(expect.objectContaining({
      repository: { repository: true }, actorUserId: 'owner_1',
      reason: 'owner_rotation', pepper: 'p'.repeat(48),
    }));
    expect(mocks.consumeAtomicRateLimit).toHaveBeenCalledWith(expect.objectContaining({
      database: { database: true },
      key: expect.stringContaining('owner_1'),
      limit: expect.any(Number),
      windowMs: expect.any(Number),
    }));
    expect(await response.json()).toEqual({
      code: 'JOIN-12345-6789A-BCDEF-GHJKM',
      codePrefix: '12345678',
      version: 2,
      revokedClaims: 3,
      joinUrl: 'https://articles.example.com/join#code=JOIN-12345-6789A-BCDEF-GHJKM',
    });
  });

  it('returns 429 and preserves the current code when the owner mutation limit is exhausted', async () => {
    mocks.consumeAtomicRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + 60_000),
    });
    const { POST } = await import('./route');
    const response = await POST(new Request(
      'https://articles.example.com/api/admin/enrollment/code/rotate',
      {
        method: 'POST',
        headers: { origin: 'https://articles.example.com', 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'owner_rotation' }),
      },
    ) as never);

    expect(response.status).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(mocks.consumeAtomicRateLimit).toHaveBeenCalledWith(expect.objectContaining({
      database: { database: true },
      key: expect.stringContaining('owner_1'),
    }));
    expect(mocks.rotateEnrollmentCode).not.toHaveBeenCalled();
  });
});
