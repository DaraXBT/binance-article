import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireActiveUser: vi.fn(async () => ({ id: 'owner_1', role: 'owner' })),
  assertTrustedMutationOrigin: vi.fn(),
  parseAuthEnvironment: vi.fn(() => ({ baseUrl: 'https://articles.example.com' })),
  getRuntimeDatabase: vi.fn(() => ({ database: true })),
  createRepository: vi.fn(() => ({ repository: true })),
  consumeAtomicRateLimit: vi.fn(async () => ({
    allowed: true, remaining: 9, resetAt: new Date(Date.now() + 60_000),
  })),
  updateEnrollmentPerson: vi.fn(async () => ({ updated: true as const, status: 'suspended' as const })),
}));

vi.mock('@/server/auth/authorization', () => ({ requireActiveUser: mocks.requireActiveUser }));
vi.mock('@/server/auth/origin', () => ({ assertTrustedMutationOrigin: mocks.assertTrustedMutationOrigin }));
vi.mock('@/server/auth/auth-policy', () => ({ parseAuthEnvironment: mocks.parseAuthEnvironment }));
vi.mock('@/server/db/runtime', () => ({ getRuntimeDatabase: mocks.getRuntimeDatabase }));
vi.mock('@/server/http/atomic-rate-limit', () => ({
  consumeAtomicRateLimit: mocks.consumeAtomicRateLimit,
}));
vi.mock('@/server/modules/admin/enrollment/repository', () => ({
  createEnrollmentAdminRepository: mocks.createRepository,
}));
vi.mock('@/server/modules/admin/enrollment/service', () => ({
  updateEnrollmentPerson: mocks.updateEnrollmentPerson,
}));

describe('PATCH /api/admin/people/:userId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('suspends a user through the owner lifecycle boundary', async () => {
    const { PATCH } = await import('./route');
    const request = new Request('https://articles.example.com/api/admin/people/user_1', {
      method: 'PATCH',
      headers: { origin: 'https://articles.example.com', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'suspend' }),
    });
    const response = await PATCH(request as never, {
      params: Promise.resolve({ userId: 'user_1' }),
    });

    expect(response.status).toBe(200);
    expect(mocks.assertTrustedMutationOrigin).toHaveBeenCalledWith(request, 'https://articles.example.com');
    expect(mocks.consumeAtomicRateLimit).toHaveBeenCalledWith(expect.objectContaining({
      database: { database: true },
      key: expect.stringContaining('owner_1'),
      limit: expect.any(Number),
      windowMs: expect.any(Number),
    }));
    expect(mocks.updateEnrollmentPerson).toHaveBeenCalledWith({
      repository: { repository: true }, actorUserId: 'owner_1',
      userId: 'user_1', action: 'suspend',
    });
    expect(await response.json()).toEqual({ updated: true, status: 'suspended' });
  });

  it('rejects unknown lifecycle actions before persistence', async () => {
    const { PATCH } = await import('./route');
    const response = await PATCH(new Request('https://articles.example.com/api/admin/people/user_1', {
      method: 'PATCH',
      headers: { origin: 'https://articles.example.com', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'delete' }),
    }) as never, { params: Promise.resolve({ userId: 'user_1' }) });

    expect(response.status).toBe(400);
    expect(mocks.updateEnrollmentPerson).not.toHaveBeenCalled();
  });

  it('returns a generic 500 when changing a person fails unexpectedly', async () => {
    mocks.updateEnrollmentPerson.mockRejectedValueOnce(
      new Error('PEOPLE_UPDATE_INTERNAL_SENTINEL'),
    );
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { PATCH } = await import('./route');
    const response = await PATCH(new Request(
      'https://articles.example.com/api/admin/people/user_1',
      {
        method: 'PATCH',
        headers: { origin: 'https://articles.example.com', 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'suspend' }),
      },
    ) as never, { params: Promise.resolve({ userId: 'user_1' }) });
    const body = await response.json();
    const logged = logSpy.mock.calls[0]?.[0] as string | undefined;
    logSpy.mockRestore();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: 'The user status could not be changed.',
      code: 'PEOPLE_UPDATE_FAILED',
    });
    expect(JSON.stringify(body)).not.toContain('PEOPLE_UPDATE_INTERNAL_SENTINEL');
    expect(logged).toBeDefined();
    expect(JSON.parse(logged ?? '{}')).toMatchObject({
      event: 'api.error',
      code: 'PEOPLE_UPDATE_FAILED',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('returns 429 and leaves the person unchanged when the owner mutation limit is exhausted', async () => {
    mocks.consumeAtomicRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + 60_000),
    });
    const { PATCH } = await import('./route');
    const response = await PATCH(new Request(
      'https://articles.example.com/api/admin/people/user_1',
      {
        method: 'PATCH',
        headers: { origin: 'https://articles.example.com', 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'suspend' }),
      },
    ) as never, { params: Promise.resolve({ userId: 'user_1' }) });

    expect(response.status).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(mocks.consumeAtomicRateLimit).toHaveBeenCalledWith(expect.objectContaining({
      database: { database: true },
      key: expect.stringContaining('owner_1'),
    }));
    expect(mocks.updateEnrollmentPerson).not.toHaveBeenCalled();
  });
});
