import { describe, expect, it, vi } from 'vitest';

import { authorizeEnrollmentRequest, authorizeRequest } from './authorization';

const request = new Request('https://articles.example.com/api/admin/invitations', {
  headers: { cookie: 'better-auth.session_token=opaque' },
});

function session(overrides: Record<string, unknown> = {}) {
  return {
    session: { id: 'session_1', userId: 'user_1' },
    user: {
      id: 'user_1',
      email: 'user@example.com',
      name: 'User',
      status: 'active',
      role: 'user',
      ...overrides,
    },
  };
}

describe('request authorization', () => {
  it('returns a minimal active actor from a database-validated session', async () => {
    const getSession = vi.fn(async () => session());

    await expect(authorizeRequest(request, { getSession })).resolves.toEqual({
      sessionId: 'session_1',
      id: 'user_1',
      email: 'user@example.com',
      name: 'User',
      status: 'active',
      role: 'user',
    });
    expect(getSession).toHaveBeenCalledWith({ headers: request.headers });
  });

  it('returns a sanitized 401 error when no session exists', async () => {
    await expect(authorizeRequest(request, { getSession: vi.fn(async () => null) }))
      .rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 401 });
  });

  it.each(['pending', 'suspended', 'revoked'])('rejects a %s user immediately', async (status) => {
    await expect(authorizeRequest(request, {
      getSession: vi.fn(async () => session({ status })),
    })).rejects.toMatchObject({ code: 'ACCOUNT_DISABLED', status: 403 });
  });

  it('allows only active or pending sessions through the enrollment completion boundary', async () => {
    await expect(authorizeEnrollmentRequest(request, {
      getSession: vi.fn(async () => session({ status: 'pending' })),
    })).resolves.toMatchObject({ id: 'user_1', status: 'pending' });
    await expect(authorizeEnrollmentRequest(request, {
      getSession: vi.fn(async () => session({ status: 'active' })),
    })).resolves.toMatchObject({ id: 'user_1', status: 'active' });

    for (const status of ['suspended', 'revoked']) {
      await expect(authorizeEnrollmentRequest(request, {
        getSession: vi.fn(async () => session({ status })),
      })).rejects.toMatchObject({ code: 'ACCOUNT_DISABLED', status: 403 });
    }
  });

  it('requires the owner role for administrative operations', async () => {
    await expect(authorizeRequest(request, {
      getSession: vi.fn(async () => session()),
      requireOwner: true,
    })).rejects.toMatchObject({ code: 'OWNER_REQUIRED', status: 403 });

    await expect(authorizeRequest(request, {
      getSession: vi.fn(async () => session({ role: 'owner' })),
      requireOwner: true,
    })).resolves.toMatchObject({ id: 'user_1', role: 'owner' });
  });

  it('fails closed for malformed session user data', async () => {
    await expect(authorizeRequest(request, {
      getSession: vi.fn(async () => session({ id: '', role: 'superadmin' })),
    })).rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 401 });
  });
});
