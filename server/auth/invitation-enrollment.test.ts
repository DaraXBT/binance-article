import { describe, expect, it, vi } from 'vitest';

import { hashEnrollmentClaimToken } from '@/server/modules/enrollment/domain';

import {
  ENROLLMENT_CLAIM_COOKIE,
  INVITATION_ENROLLMENT_COOKIE,
  createInvitationEnrollmentGate,
  serializeEnrollmentClaimCookie,
  serializeExpiredEnrollmentClaimCookie,
  serializeInvitationEnrollmentCookie,
} from './invitation-enrollment';

const rawToken = 'invite_secret_that_must_not_reach_the_database';
const rawClaim = 'A'.repeat(43);

function googleContext(cookie = `${ENROLLMENT_CLAIM_COOKIE}=${rawClaim}`) {
  return {
    request: new Request('https://articles.example.com/api/auth/callback/google', {
      headers: cookie ? { cookie } : undefined,
    }),
  };
}

describe('invitation OAuth enrollment gate', () => {
  it('atomically reserves a matching durable claim using only its hash', async () => {
    const repository = {
      reserveClaim: vi.fn(async () => ({ outcome: 'reserved' as const, claimId: 'claim_1' })),
    };
    const gate = createInvitationEnrollmentGate({
      repository,
      now: () => new Date('2026-07-19T00:00:00.000Z'),
    });

    await gate.beforeUserCreate(
      { id: 'user_1', email: 'Invited@Example.com', emailVerified: true },
      googleContext(),
    );

    expect(repository.reserveClaim).toHaveBeenCalledWith(expect.objectContaining({
      claimTokenHash: await hashEnrollmentClaimToken(rawClaim),
      email: 'invited@example.com',
      now: new Date('2026-07-19T00:00:00.000Z'),
    }));
    expect(JSON.stringify(repository.reserveClaim.mock.calls)).not.toContain(rawClaim);
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
      repository: { reserveClaim: vi.fn() },
    });

    await expect(gate.beforeUserCreate(
      { id: 'user_1', email: 'invited@example.com', emailVerified: true },
      context,
    )).rejects.toThrow(/invitation|Google/i);
  });

  it('requires Google to verify the enrollment email', async () => {
    const gate = createInvitationEnrollmentGate({
      repository: { reserveClaim: vi.fn() },
    });

    await expect(gate.beforeUserCreate(
      { email: 'invited@example.com', emailVerified: false },
      googleContext(),
    )).rejects.toThrow(/verified Google/i);
  });

  it('rejects an invalid, expired, used, revoked, or email-mismatched invitation', async () => {
    const gate = createInvitationEnrollmentGate({
      repository: {
        reserveClaim: vi.fn(async () => ({ outcome: 'invalid' as const })),
      },
    });

    await expect(gate.beforeUserCreate(
      { id: 'user_1', email: 'other@example.com', emailVerified: true },
      googleContext(),
    )).rejects.toThrow(/invalid or expired/i);
  });

  it('leaves activation and durable user linking to the retryable completion endpoint', async () => {
    const repository = {
      reserveClaim: vi.fn(async () => ({ outcome: 'reserved' as const, claimId: 'claim_1' })),
    };
    const gate = createInvitationEnrollmentGate({ repository });
    const user = { id: 'user_1', email: 'invited@example.com', emailVerified: true };
    const context = googleContext();

    await gate.beforeUserCreate(user, context);
    await gate.afterUserCreate(user, context);

    expect(repository.reserveClaim).toHaveBeenCalledTimes(1);
  });

  it('re-reads the durable claim after creation instead of process-local reservation state', async () => {
    const repository = {
      reserveClaim: vi.fn(async () => ({ outcome: 'reserved' as const, claimId: 'claim_1' })),
    };
    const gate = createInvitationEnrollmentGate({ repository });
    const context = googleContext();

    await gate.beforeUserCreate({ email: 'Invited@Example.com', emailVerified: true }, context);
    const restartedGate = createInvitationEnrollmentGate({ repository: repository });
    await restartedGate.afterUserCreate({
      id: 'user_1', email: 'invited@example.com', emailVerified: true,
    }, context);

    expect(repository.reserveClaim).toHaveBeenCalledTimes(1);
  });
});

describe('durable enrollment claim cookie', () => {
  it('is short-lived, HttpOnly, and available to auth and completion APIs', () => {
    const cookie = serializeEnrollmentClaimCookie(rawClaim, { secure: true });

    expect(cookie).toContain(`${ENROLLMENT_CLAIM_COOKIE}=`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/api');
    expect(cookie).toContain('Max-Age=900');
  });

  it('can be expired without echoing the claim token', () => {
    const cookie = serializeExpiredEnrollmentClaimCookie({ secure: true });
    expect(cookie).toContain(`${ENROLLMENT_CLAIM_COOKIE}=`);
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).not.toContain(rawClaim);
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
