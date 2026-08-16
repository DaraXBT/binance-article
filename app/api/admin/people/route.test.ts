import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireActiveUser: vi.fn(async () => ({ id: 'owner_1', role: 'owner' })),
  getRuntimeDatabase: vi.fn(() => ({ database: true })),
  createRepository: vi.fn(() => ({ repository: true })),
  listEnrollmentPeople: vi.fn(async () => [{
    id: 'owner_1', name: 'Owner', email: 'owner@example.com', role: 'owner' as const,
    status: 'active' as const, enrollmentSource: 'bootstrap',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    lastActiveAt: new Date('2026-08-09T00:00:00.000Z'), isCurrentUser: true,
  }]),
}));

vi.mock('@/server/auth/authorization', () => ({ requireActiveUser: mocks.requireActiveUser }));
vi.mock('@/server/db/runtime', () => ({ getRuntimeDatabase: mocks.getRuntimeDatabase }));
vi.mock('@/server/modules/admin/enrollment/repository', () => ({
  createEnrollmentAdminRepository: mocks.createRepository,
}));
vi.mock('@/server/modules/admin/enrollment/service', () => ({
  listEnrollmentPeople: mocks.listEnrollmentPeople,
}));

describe('GET /api/admin/people', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists lifecycle-safe user metadata for an owner', async () => {
    const { GET } = await import('./route');
    const request = new Request('https://articles.example.com/api/admin/people');
    const response = await GET(request as never);

    expect(response.status).toBe(200);
    expect(mocks.requireActiveUser).toHaveBeenCalledWith(request, { requireOwner: true });
    expect(mocks.listEnrollmentPeople).toHaveBeenCalledWith({
      repository: { repository: true }, actorUserId: 'owner_1',
    });
    expect(await response.json()).toEqual({ people: [{
      id: 'owner_1', name: 'Owner', email: 'owner@example.com', role: 'owner',
      status: 'active', enrollmentSource: 'bootstrap',
      createdAt: '2026-08-01T00:00:00.000Z',
      lastActiveAt: '2026-08-09T00:00:00.000Z', isCurrentUser: true,
    }] });
  });

  it('returns a generic 500 when listing people fails unexpectedly', async () => {
    mocks.listEnrollmentPeople.mockRejectedValueOnce(
      new Error('PEOPLE_LIST_INTERNAL_SENTINEL'),
    );
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { GET } = await import('./route');
    const response = await GET(new Request(
      'https://articles.example.com/api/admin/people',
    ) as never);
    const body = await response.json();
    const logged = logSpy.mock.calls[0]?.[0] as string | undefined;
    logSpy.mockRestore();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: 'People could not be loaded.',
      code: 'PEOPLE_LIST_FAILED',
    });
    expect(JSON.stringify(body)).not.toContain('PEOPLE_LIST_INTERNAL_SENTINEL');
    expect(logged).toBeDefined();
    expect(JSON.parse(logged ?? '{}')).toMatchObject({
      event: 'api.error',
      code: 'PEOPLE_LIST_FAILED',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
