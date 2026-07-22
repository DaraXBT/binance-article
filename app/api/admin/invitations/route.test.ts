import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireActiveUser: vi.fn(async () => ({ id: 'owner_1', role: 'owner' })),
  assertAllowedOrigin: vi.fn(),
  getRuntimeDatabase: vi.fn(() => ({ db: true })),
  createRepository: vi.fn(() => ({ repository: true })),
  createInvitation: vi.fn(async () => ({
    token: 'invite_token_value_12345678901234567890',
    tokenPrefix: 'invite_t',
    expiresAt: new Date('2026-07-20T00:00:00.000Z'),
  })),
}));

vi.mock('@/server/auth/authorization', () => ({ requireActiveUser: mocks.requireActiveUser }));
vi.mock('@/server/auth/origin', () => ({ assertAllowedOrigin: mocks.assertAllowedOrigin }));
vi.mock('@/server/db/runtime', () => ({ getRuntimeDatabase: mocks.getRuntimeDatabase }));
vi.mock('@/server/modules/admin/invitations/repository', () => ({
  createInvitationAdminRepository: mocks.createRepository,
}));
vi.mock('@/server/modules/admin/invitations/service', () => ({ createInvitation: mocks.createInvitation }));

describe('POST /api/admin/invitations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires owner access and returns the one-time join link', async () => {
    const { POST } = await import('./route');
    const request = new Request('https://articles.example.com/api/admin/invitations', {
      method: 'POST',
      headers: { origin: 'https://articles.example.com', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'invited@example.com' }),
    });
    const response = await POST(request as never);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(mocks.assertAllowedOrigin).toHaveBeenCalledWith(request);
    expect(mocks.requireActiveUser).toHaveBeenCalledWith(request, { requireOwner: true });
    expect(mocks.createInvitation).toHaveBeenCalledWith(expect.objectContaining({
      repository: { repository: true },
      actorUserId: 'owner_1',
      email: 'invited@example.com',
    }));
    expect(body).toEqual({
      invitation: {
        tokenPrefix: 'invite_t',
        expiresAt: '2026-07-20T00:00:00.000Z',
        joinUrl: 'https://articles.example.com/join?token=invite_token_value_12345678901234567890',
      },
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('returns a sanitized payload-validation error', async () => {
    const { POST } = await import('./route');
    const response = await POST(new Request('https://articles.example.com/api/admin/invitations', {
      method: 'POST',
      body: '{bad json',
    }) as never);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'INVALID_JSON_BODY' });
  });
});
