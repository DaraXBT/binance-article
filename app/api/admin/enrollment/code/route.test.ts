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
  createInitialEnrollmentCode: vi.fn(async () => ({ code: 'JOIN-ABCDE-FGHJK-MNPQR-STUVW', codePrefix: 'ABCDEFGH', version: 1 })),
  revokeEnrollmentCode: vi.fn(async () => ({ changed: true, revokedClaims: 2 })),
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
  createInitialEnrollmentCode: mocks.createInitialEnrollmentCode,
  revokeEnrollmentCode: mocks.revokeEnrollmentCode,
}));

describe('POST /api/admin/enrollment/code', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates an owner-only one-time code and fragment join link', async () => {
    const { POST } = await import('./route');
    const request = new Request('https://poisoned.example/api/admin/enrollment/code', {
      method: 'POST',
      headers: { origin: 'https://articles.example.com', 'content-type': 'application/json' },
      body: '{}',
    });
    const response = await POST(request as never);

    expect(response.status).toBe(201);
    expect(mocks.assertTrustedMutationOrigin).toHaveBeenCalledWith(request, 'https://articles.example.com');
    expect(mocks.requireActiveUser).toHaveBeenCalledWith(request, { requireOwner: true });
    expect(mocks.consumeAtomicRateLimit).toHaveBeenCalledWith(expect.objectContaining({
      database: { database: true },
      key: expect.stringContaining('owner_1'),
      limit: expect.any(Number),
      windowMs: expect.any(Number),
    }));
    expect(mocks.createInitialEnrollmentCode).toHaveBeenCalledWith(expect.objectContaining({
      repository: { repository: true }, actorUserId: 'owner_1', pepper: 'p'.repeat(48),
    }));
    expect(await response.json()).toEqual({
      code: 'JOIN-ABCDE-FGHJK-MNPQR-STUVW',
      codePrefix: 'ABCDEFGH',
      version: 1,
      joinUrl: 'https://articles.example.com/join#code=JOIN-ABCDE-FGHJK-MNPQR-STUVW',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('returns a generic 500 response when creating enrollment fails unexpectedly', async () => {
    mocks.createInitialEnrollmentCode.mockRejectedValueOnce(new Error('INTERNAL_SENTINEL'));
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { POST } = await import('./route');
    const response = await POST(new Request(
      'https://articles.example.com/api/admin/enrollment/code',
      {
        method: 'POST',
        headers: { origin: 'https://articles.example.com', 'content-type': 'application/json' },
        body: '{}',
      },
    ) as never);
    const body = await response.json();
    expect(logSpy).toHaveBeenCalledOnce();
    const logged = JSON.parse(logSpy.mock.calls[0]?.[0] as string) as {
      event?: string;
      code?: string;
      cause?: string;
    };
    logSpy.mockRestore();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: 'The enrollment code could not be created.',
      code: 'ENROLLMENT_CODE_CREATE_FAILED',
    });
    expect(JSON.stringify(body)).not.toContain('INTERNAL_SENTINEL');
    expect(logged).toMatchObject({
      event: 'api.error',
      code: 'ENROLLMENT_CODE_CREATE_FAILED',
    });
    expect(logged.cause).toContain('INTERNAL_SENTINEL');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('returns 429 and does not create a code when the owner mutation limit is exhausted', async () => {
    mocks.consumeAtomicRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + 60_000),
    });
    const { POST } = await import('./route');
    const response = await POST(new Request('https://articles.example.com/api/admin/enrollment/code', {
      method: 'POST',
      headers: { origin: 'https://articles.example.com', 'content-type': 'application/json' },
      body: '{}',
    }) as never);

    expect(response.status).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(mocks.consumeAtomicRateLimit).toHaveBeenCalledWith(expect.objectContaining({
      database: { database: true },
      key: expect.stringContaining('owner_1'),
    }));
    expect(mocks.createInitialEnrollmentCode).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/enrollment/code', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lets an owner disable enrollment without returning code material', async () => {
    const { DELETE } = await import('./route');
    const request = new Request('https://poisoned.example/api/admin/enrollment/code', {
      method: 'DELETE',
      headers: { origin: 'https://articles.example.com' },
    });
    const response = await DELETE(request as never);

    expect(response.status).toBe(200);
    expect(mocks.assertTrustedMutationOrigin).toHaveBeenCalledWith(request, 'https://articles.example.com');
    expect(mocks.requireActiveUser).toHaveBeenCalledWith(request, { requireOwner: true });
    expect(mocks.revokeEnrollmentCode).toHaveBeenCalledWith(expect.objectContaining({
      repository: { repository: true }, actorUserId: 'owner_1',
    }));
    expect(mocks.getEnrollmentCodePepper).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      disabled: true,
      changed: true,
      revokedClaims: 2,
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('returns a safe success response when enrollment is already disabled', async () => {
    mocks.revokeEnrollmentCode.mockResolvedValueOnce({ changed: false, revokedClaims: 0 });
    const { DELETE } = await import('./route');
    const response = await DELETE(new Request(
      'https://articles.example.com/api/admin/enrollment/code',
      { method: 'DELETE', headers: { origin: 'https://articles.example.com' } },
    ) as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      disabled: true,
      changed: false,
      revokedClaims: 0,
    });
    expect(mocks.getEnrollmentCodePepper).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('returns a generic 500 response when disabling enrollment fails unexpectedly', async () => {
    mocks.revokeEnrollmentCode.mockRejectedValueOnce(new Error('INTERNAL_SENTINEL'));
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { DELETE } = await import('./route');
    const response = await DELETE(new Request(
      'https://articles.example.com/api/admin/enrollment/code',
      { method: 'DELETE', headers: { origin: 'https://articles.example.com' } },
    ) as never);
    const body = await response.json();
    logSpy.mockRestore();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: 'The enrollment code could not be disabled.',
      code: 'ENROLLMENT_CODE_REVOKE_FAILED',
    });
    expect(JSON.stringify(body)).not.toContain('INTERNAL_SENTINEL');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('preserves the active code when the owner mutation limit is exhausted', async () => {
    mocks.consumeAtomicRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + 60_000),
    });
    const { DELETE } = await import('./route');
    const response = await DELETE(new Request(
      'https://articles.example.com/api/admin/enrollment/code',
      { method: 'DELETE', headers: { origin: 'https://articles.example.com' } },
    ) as never);

    expect(response.status).toBe(429);
    expect(mocks.revokeEnrollmentCode).not.toHaveBeenCalled();
  });
});
