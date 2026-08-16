import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/server/http/errors';

const claimToken = 'A'.repeat(43);
const mocks = vi.hoisted(() => ({
  assertTrustedMutationOrigin: vi.fn(),
  parseAuthEnvironment: vi.fn(() => ({
    baseUrl: 'https://articles.example.com',
    secureCookies: true,
  })),
  requireEnrollmentUser: vi.fn(async () => ({
    id: 'user_1', email: 'user@example.com', status: 'pending', sessionId: 'session_1',
  })),
  getRuntimeDatabase: vi.fn(() => ({ database: true })),
  createEnrollmentRepository: vi.fn(() => ({ repository: true })),
  reserveEnrollmentClaim: vi.fn(async () => ({
    reserved: true as const, replayed: true, claimId: 'claim_1',
  })),
  completeEnrollmentClaim: vi.fn(async () => ({
    completed: true as const,
    replayed: false,
    claimId: 'claim_1',
    workspaceId: 'workspace_1',
  })),
  releaseEnrollmentClaim: vi.fn(async () => ({ released: true })),
}));

vi.mock('@/server/auth/auth-policy', () => ({ parseAuthEnvironment: mocks.parseAuthEnvironment }));
vi.mock('@/server/auth/origin', () => ({
  assertTrustedMutationOrigin: mocks.assertTrustedMutationOrigin,
}));
vi.mock('@/server/auth/authorization', () => ({
  requireEnrollmentUser: mocks.requireEnrollmentUser,
}));
vi.mock('@/server/db/runtime', () => ({ getRuntimeDatabase: mocks.getRuntimeDatabase }));
vi.mock('@/server/modules/enrollment/repository', () => ({
  createEnrollmentRepository: mocks.createEnrollmentRepository,
}));
vi.mock('@/server/modules/enrollment/service', () => ({
  reserveEnrollmentClaim: mocks.reserveEnrollmentClaim,
  completeEnrollmentClaim: mocks.completeEnrollmentClaim,
  releaseEnrollmentClaim: mocks.releaseEnrollmentClaim,
}));

function request() {
  return new Request('https://articles.example.com/api/enrollment/complete', {
    method: 'POST',
    headers: {
      origin: 'https://articles.example.com',
      cookie: `xarticle_enrollment_claim=${claimToken}`,
    },
  });
}

describe('POST /api/enrollment/complete', () => {
  beforeEach(() => vi.clearAllMocks());

  it('idempotently finalizes a pending user and clears the bearer claim', async () => {
    const { POST } = await import('./route');
    const input = request();
    const response = await POST(input as never);

    expect(response.status).toBe(200);
    expect(mocks.assertTrustedMutationOrigin).toHaveBeenCalledWith(
      input,
      'https://articles.example.com',
    );
    expect(mocks.reserveEnrollmentClaim).toHaveBeenCalledWith({
      repository: { repository: true },
      claimToken,
      email: 'user@example.com',
    });
    expect(mocks.completeEnrollmentClaim).toHaveBeenCalledWith({
      repository: { repository: true },
      claimToken,
      userId: 'user_1',
    });
    expect(await response.json()).toEqual({
      enrollment: { completed: true, replayed: false },
    });
    expect(response.headers.get('set-cookie')).toMatch(
      /xarticle_enrollment_claim=; Max-Age=0; Path=\/api; HttpOnly; SameSite=Lax; Secure/i,
    );
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('supports an already-active Google user without creating another identity', async () => {
    mocks.requireEnrollmentUser.mockResolvedValueOnce({
      id: 'user_1', email: 'user@example.com', status: 'active', sessionId: 'session_1',
    });
    mocks.reserveEnrollmentClaim.mockResolvedValueOnce({
      reserved: false as const,
      existingUser: true as const,
      claimId: 'claim_1',
      userId: 'user_1',
    } as never);
    const { POST } = await import('./route');
    const response = await POST(request() as never);

    expect(response.status).toBe(200);
    expect(mocks.completeEnrollmentClaim).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user_1',
    }));
  });

  it('releases a reservation after a retryable finalization failure', async () => {
    mocks.completeEnrollmentClaim.mockRejectedValueOnce(new Error('database unavailable'));
    const { POST } = await import('./route');
    const response = await POST(request() as never);

    expect(response.status).toBe(500);
    expect(mocks.releaseEnrollmentClaim).toHaveBeenCalledWith({
      repository: { repository: true },
      claimToken,
      email: 'user@example.com',
    });
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('clears an invalid or rotated claim and returns actionable safe state', async () => {
    mocks.reserveEnrollmentClaim.mockRejectedValueOnce(new AppError({
      code: 'INVALID_ENROLLMENT_CLAIM',
      message: 'The enrollment attempt is invalid or no longer available.',
      status: 400,
    }));
    const { POST } = await import('./route');
    const response = await POST(request() as never);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'INVALID_ENROLLMENT_CLAIM' });
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
