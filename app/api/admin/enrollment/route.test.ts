import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireActiveUser: vi.fn(async () => ({ id: 'owner_1', role: 'owner' })),
  getRuntimeDatabase: vi.fn(() => ({ database: true })),
  createRepository: vi.fn(() => ({ repository: true })),
  getEnrollmentOverview: vi.fn(async () => ({
    code: {
      version: 2,
      codePrefix: 'ABCDEFGH',
      status: 'active' as const,
      createdAt: new Date('2026-08-09T00:00:00.000Z'),
    },
    capacity: { activeUsers: 2, legacyInvitations: 3, reservedClaims: 1, limit: 10 },
  })),
}));

vi.mock('@/server/auth/authorization', () => ({ requireActiveUser: mocks.requireActiveUser }));
vi.mock('@/server/db/runtime', () => ({ getRuntimeDatabase: mocks.getRuntimeDatabase }));
vi.mock('@/server/modules/admin/enrollment/repository', () => ({
  createEnrollmentAdminRepository: mocks.createRepository,
}));
vi.mock('@/server/modules/admin/enrollment/service', () => ({
  getEnrollmentOverview: mocks.getEnrollmentOverview,
}));

describe('GET /api/admin/enrollment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns owner-only code metadata and durable capacity counts', async () => {
    const { GET } = await import('./route');
    const request = new Request('https://articles.example.com/api/admin/enrollment');
    const response = await GET(request as never);

    expect(response.status).toBe(200);
    expect(mocks.requireActiveUser).toHaveBeenCalledWith(request, { requireOwner: true });
    expect(mocks.getEnrollmentOverview).toHaveBeenCalledWith({ repository: { repository: true } });
    expect(await response.json()).toEqual({
      activeCode: {
        version: 2,
        codePrefix: 'ABCDEFGH',
        status: 'active',
        createdAt: '2026-08-09T00:00:00.000Z',
      },
      capacity: { activeUsers: 2, legacyInvitations: 3, reservedClaims: 1, limit: 10 },
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
