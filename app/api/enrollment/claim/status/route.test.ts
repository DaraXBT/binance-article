import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRuntimeDatabase: vi.fn(() => ({ database: true })),
  createEnrollmentRepository: vi.fn(() => ({ repository: true })),
  isEnrollmentClaimReady: vi.fn(async () => true),
}));

vi.mock('@/server/db/runtime', () => ({ getRuntimeDatabase: mocks.getRuntimeDatabase }));
vi.mock('@/server/modules/enrollment/repository', () => ({
  createEnrollmentRepository: mocks.createEnrollmentRepository,
}));
vi.mock('@/server/modules/enrollment/service', () => ({
  isEnrollmentClaimReady: mocks.isEnrollmentClaimReady,
}));

describe('GET /api/enrollment/claim/status', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns only server-validated readiness for the HttpOnly claim cookie', async () => {
    const { GET } = await import('./route');
    const claimToken = 'A'.repeat(43);
    const request = new Request('https://articles.example.com/api/enrollment/claim/status', {
      headers: { cookie: `xarticle_enrollment_claim=${claimToken}` },
    });

    const response = await GET(request as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ready: true });
    expect(JSON.stringify(body)).not.toContain(claimToken);
    expect(mocks.isEnrollmentClaimReady).toHaveBeenCalledWith({
      repository: { repository: true },
      claimToken,
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('fails closed without touching persistence when the cookie is absent', async () => {
    const { GET } = await import('./route');
    const response = await GET(new Request(
      'https://articles.example.com/api/enrollment/claim/status',
    ) as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ready: false });
    expect(mocks.getRuntimeDatabase).not.toHaveBeenCalled();
    expect(mocks.isEnrollmentClaimReady).not.toHaveBeenCalled();
  });
});
