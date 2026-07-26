import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireActiveUser: vi.fn(async () => ({ id: 'owner_1', role: 'owner' })),
  assertAllowedOrigin: vi.fn(),
  getRuntimeDatabase: vi.fn(() => ({ db: true })),
  createRepository: vi.fn(() => ({ repository: true })),
  revokeInvitation: vi.fn(async () => ({ revoked: true as const })),
  logEvent: vi.fn(),
}));

vi.mock('@/server/auth/authorization', () => ({ requireActiveUser: mocks.requireActiveUser }));
vi.mock('@/server/auth/origin', () => ({ assertAllowedOrigin: mocks.assertAllowedOrigin }));
vi.mock('@/server/db/runtime', () => ({ getRuntimeDatabase: mocks.getRuntimeDatabase }));
vi.mock('@/server/http/log', () => ({ logEvent: mocks.logEvent }));
vi.mock('@/server/modules/admin/invitations/repository', () => ({
  createInvitationAdminRepository: mocks.createRepository,
}));
vi.mock('@/server/modules/admin/invitations/service', () => ({
  revokeInvitation: mocks.revokeInvitation,
}));

describe('DELETE /api/admin/invitations/[id]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('revokes as owner and records the actor in the structured log', async () => {
    const { DELETE } = await import('./route');
    const request = new Request('https://articles.example.com/api/admin/invitations/invite_1', {
      method: 'DELETE',
      headers: { origin: 'https://articles.example.com' },
    });
    const response = await DELETE(request as never, {
      params: Promise.resolve({ id: 'invite_1' }),
    });

    expect(response.status).toBe(200);
    expect(mocks.assertAllowedOrigin).toHaveBeenCalledWith(request);
    expect(mocks.requireActiveUser).toHaveBeenCalledWith(request, { requireOwner: true });
    expect(mocks.revokeInvitation).toHaveBeenCalledWith({
      repository: { repository: true },
      invitationId: 'invite_1',
      actorUserId: 'owner_1',
    });
    expect(mocks.logEvent).toHaveBeenCalledWith('info', 'admin.invitation.revoked', {
      invitationId: 'invite_1',
      actorUserId: 'owner_1',
    });
    await expect(response.json()).resolves.toEqual({ revoked: true });
  });

  it('propagates service errors through the sanitized envelope', async () => {
    const { AppError } = await import('@/server/http/app-error');
    mocks.revokeInvitation.mockRejectedValueOnce(new AppError({
      code: 'INVITATION_NOT_FOUND', message: 'Invitation not found.', status: 404,
    }) as never);

    const { DELETE } = await import('./route');
    const response = await DELETE(new Request(
      'https://articles.example.com/api/admin/invitations/unknown',
      { method: 'DELETE' },
    ) as never, { params: Promise.resolve({ id: 'unknown' }) });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'INVITATION_NOT_FOUND' });
    expect(mocks.logEvent).not.toHaveBeenCalled();
  });
});
