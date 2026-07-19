import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertAllowedOrigin: vi.fn(),
  getRuntimeDatabase: vi.fn(() => ({ db: true })),
  createRepository: vi.fn(() => ({ repository: true })),
  inspectInvitation: vi.fn(async () => ({ email: 'invited@example.com' })),
}));

vi.mock('@/server/auth/origin', () => ({ assertAllowedOrigin: mocks.assertAllowedOrigin }));
vi.mock('@/server/db/runtime', () => ({ getRuntimeDatabase: mocks.getRuntimeDatabase }));
vi.mock('@/server/modules/admin/invitations/repository', () => ({
  createInvitationAdminRepository: mocks.createRepository,
}));
vi.mock('@/server/modules/admin/invitations/service', () => ({
  inspectInvitation: mocks.inspectInvitation,
}));

describe('POST /api/invitations/accept', () => {
  it('validates the token and stores it only in a short-lived HttpOnly cookie', async () => {
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
    expect(mocks.inspectInvitation).toHaveBeenCalledWith({
      repository: { repository: true },
      token,
    });
    expect(response.headers.get('set-cookie')).toMatch(
      /xarticle_invitation=.*HttpOnly.*SameSite=Lax.*Secure/i,
    );
    expect(body).toEqual({ success: true, email: 'invited@example.com' });
    expect(JSON.stringify(body)).not.toContain(token);
  });

  it('returns a generic invalid-invitation response', async () => {
    mocks.inspectInvitation.mockRejectedValueOnce(Object.assign(new Error('invalid'), {
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
});
