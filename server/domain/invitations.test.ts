import { describe, expect, it } from 'vitest';

import {
  INVITATION_LIFETIME_MS,
  createInvitationSecret,
  evaluateInvitation,
  hashInvitationToken,
} from './invitations';

describe('invitation secrets', () => {
  it('creates a high-entropy token while returning only its hash for persistence', async () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, index) => index);
    const secret = await createInvitationSecret(bytes);

    expect(secret.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secret.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(secret.tokenHash).toBe(await hashInvitationToken(secret.token));
    expect(secret.tokenHash).not.toContain(secret.token);
    expect(secret.tokenPrefix).toBe(secret.token.slice(0, 8));
  });

  it('accepts only the matching unused token before its 24-hour expiry', async () => {
    const now = new Date('2026-07-19T00:00:00.000Z');
    const token = 'invite_secret_that_is_never_stored_in_plaintext';
    const invitation = {
      tokenHash: await hashInvitationToken(token),
      status: 'pending' as const,
      expiresAt: new Date(now.getTime() + INVITATION_LIFETIME_MS),
    };

    await expect(evaluateInvitation(invitation, token, now)).resolves.toEqual({ ok: true });
    await expect(evaluateInvitation(invitation, 'wrong-token', now)).resolves.toEqual({
      ok: false,
      reason: 'invalid_token',
    });
  });

  it.each([
    ['expired', { status: 'pending' as const, expiresAt: new Date('2026-07-19T00:00:00.000Z') }],
    ['used', { status: 'accepted' as const, expiresAt: new Date('2026-07-20T00:00:00.000Z') }],
    ['revoked', { status: 'revoked' as const, expiresAt: new Date('2026-07-20T00:00:00.000Z') }],
  ])('rejects an %s invitation without revealing whether its token matches', async (reason, fields) => {
    const token = 'invite-secret';
    const result = await evaluateInvitation(
      { tokenHash: await hashInvitationToken(token), ...fields },
      token,
      new Date('2026-07-19T00:00:00.000Z'),
    );

    expect(result).toEqual({ ok: false, reason });
  });
});
