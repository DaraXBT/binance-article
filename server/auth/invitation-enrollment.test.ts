import { describe, expect, it, vi } from 'vitest';

import { hashInvitationToken } from '@/server/domain/invitations';

import {
  INVITATION_ENROLLMENT_COOKIE,
  createInvitationEnrollmentGate,
  serializeInvitationEnrollmentCookie,
} from './invitation-enrollment';

const rawToken = 'invite_secret_that_must_not_reach_the_database';

function googleContext(cookie = `${INVITATION_ENROLLMENT_COOKIE}=${rawToken}`) {
  return {
    request: new Request('https://articles.example.com/api/auth/callback/google', {
      headers: cookie ? { cookie } : undefined,
    }),
  };
}

describe('invitation OAuth enrollment gate', () => {
  it('atomically reserves a matching invitation using only its hash', async () => {
    const repository = {
      reserve: vi.fn(async () => ({ id: 'invite_1' })),
      attachUser: vi.fn(async () => undefined),
    };
    const gate = createInvitationEnrollmentGate({
      repository,
      now: () => new Date('2026-07-19T00:00:00.000Z'),
    });

    await gate.beforeUserCreate(
      { id: 'user_1', email: 'Invited@Example.com' },
      googleContext(),
    );

    expect(repository.reserve).toHaveBeenCalledWith({
      tokenHash: await hashInvitationToken(rawToken),
      email: 'invited@example.com',
      now: new Date('2026-07-19T00:00:00.000Z'),
    });
    expect(JSON.stringify(repository.reserve.mock.calls)).not.toContain(rawToken);
  });

  it.each([
    ['missing cookie', googleContext('')],
    ['missing request', {}],
    ['non-Google signup', {
      request: new Request('https://articles.example.com/api/auth/callback/github', {
        headers: { cookie: `${INVITATION_ENROLLMENT_COOKIE}=${rawToken}` },
      }),
    }],
  ])('rejects %s', async (_label, context) => {
    const gate = createInvitationEnrollmentGate({
      repository: { reserve: vi.fn(), attachUser: vi.fn() },
    });

    await expect(gate.beforeUserCreate(
      { id: 'user_1', email: 'invited@example.com' },
      context,
    )).rejects.toThrow(/invitation|Google/i);
  });

  it('rejects an invalid, expired, used, revoked, or email-mismatched invitation', async () => {
    const gate = createInvitationEnrollmentGate({
      repository: {
        reserve: vi.fn(async () => null),
        attachUser: vi.fn(),
      },
    });

    await expect(gate.beforeUserCreate(
      { id: 'user_1', email: 'other@example.com' },
      googleContext(),
    )).rejects.toThrow(/invalid or expired/i);
  });

  it('links the consumed invitation to the created user after insertion', async () => {
    const repository = {
      reserve: vi.fn(async () => ({ id: 'invite_1' })),
      attachUser: vi.fn(async () => undefined),
    };
    const gate = createInvitationEnrollmentGate({ repository });
    const user = { id: 'user_1', email: 'invited@example.com' };
    const context = googleContext();

    await gate.beforeUserCreate(user, context);
    await gate.afterUserCreate(user, context);

    expect(repository.attachUser).toHaveBeenCalledWith({
      invitationId: 'invite_1',
      userId: 'user_1',
      now: expect.any(Date),
    });
  });

  it('reserves before Better Auth assigns an id, then links the inserted user', async () => {
    const repository = {
      reserve: vi.fn(async () => ({ id: 'invite_1' })),
      attachUser: vi.fn(async () => undefined),
    };
    const gate = createInvitationEnrollmentGate({ repository });
    const context = googleContext();

    await gate.beforeUserCreate({ email: 'Invited@Example.com' }, context);
    await gate.afterUserCreate({ id: 'user_1', email: 'invited@example.com' }, context);

    expect(repository.attachUser).toHaveBeenCalledWith({
      invitationId: 'invite_1',
      userId: 'user_1',
      now: expect.any(Date),
    });
  });
});

describe('invitation enrollment cookie', () => {
  it('is short-lived, HttpOnly, OAuth-compatible, and scoped to auth callbacks', () => {
    const cookie = serializeInvitationEnrollmentCookie(rawToken, { secure: true });

    expect(cookie).toContain(`${INVITATION_ENROLLMENT_COOKIE}=`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/api/auth');
    expect(cookie).toContain('Max-Age=900');
  });

  it('rejects control characters instead of creating a malformed cookie', () => {
    expect(() => serializeInvitationEnrollmentCookie('token\r\nSet-Cookie: evil=1', { secure: true }))
      .toThrow(/token/i);
  });
});
