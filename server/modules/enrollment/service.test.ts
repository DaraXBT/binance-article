import { describe, expect, it, vi } from 'vitest';

import { AppError } from '@/server/http/errors';

import {
  ENROLLMENT_CLAIM_TTL_MS,
  MAX_ACTIVE_ENROLLMENT_USERS,
  type EnrollmentClaimRepository,
  claimEnrollmentCode,
  claimLegacyInvitation,
  completeEnrollmentClaim,
  createInitialEnrollmentCode,
  revokeEnrollmentCode,
  reserveEnrollmentClaim,
  rotateEnrollmentCode,
} from './service';

const now = new Date('2026-08-09T00:00:00.000Z');
const pepper = 'pepper'.repeat(8);
const code = 'JOIN-01234-56789-ABCDE-FGHJK';
const claimToken = 'A'.repeat(43);

function repository(overrides: Record<string, unknown> = {}) {
  return {
    findActiveCodeByHash: vi.fn(async () => ({
      id: 'code_1', version: 1, codePrefix: '01234567', status: 'active' as const,
    })),
    createClaim: vi.fn(async (input: Parameters<EnrollmentClaimRepository['createClaim']>[0]) => ({
      id: 'claim_1',
      codeId: input.codeId,
      codeVersion: input.codeVersion,
      source: input.source,
      status: 'pending' as const,
      expiresAt: input.expiresAt,
      reservationExpiresAt: null,
      email: null,
      userId: null,
    })),
    createLegacyClaim: vi.fn(async (input: { expiresAt: Date }) => ({
      id: 'legacy_claim_1', codeId: null, codeVersion: null,
      source: 'legacy_invitation' as const, status: 'pending' as const,
      email: 'invited@example.com', userId: null,
      expiresAt: input.expiresAt, reservationExpiresAt: null,
    })),
    reserveClaim: vi.fn(async () => ({ outcome: 'reserved' as const, claimId: 'claim_1' })),
    completeClaim: vi.fn(async () => ({ outcome: 'completed' as const, claimId: 'claim_1' })),
    releaseClaim: vi.fn(async () => true),
    createCode: vi.fn(async () => ({ outcome: 'created' as const, version: 1 })),
    revokeCode: vi.fn(async () => ({
      outcome: 'revoked' as const, revokedCodeId: 'code_1', revokedClaims: 2,
    })),
    rotateCode: vi.fn(async () => ({ version: 2, revokedCodeId: 'code_1', revokedClaims: 2 })),
    ...overrides,
  };
}

describe('enrollment service', () => {
  it('creates a reusable claim without persisting the raw shared code', async () => {
    const repo = repository();
    const result = await claimEnrollmentCode({
      repository: repo,
      code,
      pepper,
      now,
      claimEntropy: new Uint8Array(32),
      id: 'claim_1',
    });

    expect(result.claimToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(result.expiresAt).toEqual(new Date(now.getTime() + ENROLLMENT_CLAIM_TTL_MS));
    expect(repo.findActiveCodeByHash).toHaveBeenCalledTimes(1);
    expect(repo.createClaim).toHaveBeenCalledWith(expect.objectContaining({
      id: 'claim_1', codeId: 'code_1', codeVersion: 1, source: 'shared_code',
      expiresAt: result.expiresAt,
    }));
    expect(JSON.stringify(repo.createClaim.mock.calls)).not.toContain(code);
  });

  it('maps invalid, expired, and rotated codes to one generic error', async () => {
    const repo = repository({ findActiveCodeByHash: vi.fn(async () => null) });
    await expect(claimEnrollmentCode({ repository: repo, code, pepper, now }))
      .rejects.toMatchObject({ code: 'INVALID_ENROLLMENT_CODE', status: 400 });
  });

  it('exchanges a legacy invitation into a deterministic retry-safe claim', async () => {
    const repo = repository();
    const invitationToken = 'legacy_invitation_token_12345678901234567890';
    const first = await claimLegacyInvitation({
      repository: repo,
      invitationToken,
      id: 'legacy_claim_1',
      now,
    });
    const replay = await claimLegacyInvitation({
      repository: repo,
      invitationToken,
      id: 'legacy_claim_2',
      now,
    });

    expect(first.claimToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(replay.claimToken).toBe(first.claimToken);
    expect(first.email).toBe('invited@example.com');
    expect(JSON.stringify(repo.createLegacyClaim.mock.calls)).not.toContain(invitationToken);
  });

  it('returns the same opaque claim token when a client safely retries one exchange', async () => {
    const repo = repository();
    const first = await claimEnrollmentCode({
      repository: repo,
      code,
      pepper,
      idempotencyKey: 'attempt-12345678',
      id: 'claim_1',
      now,
    });
    const replay = await claimEnrollmentCode({
      repository: repo,
      code: code.toLowerCase(),
      pepper,
      idempotencyKey: 'attempt-12345678',
      id: 'claim_2',
      now,
    });

    expect(replay.claimToken).toBe(first.claimToken);
    expect(repo.createClaim.mock.calls[1]?.[0].tokenHash)
      .toBe(repo.createClaim.mock.calls[0]?.[0].tokenHash);
  });

  it('reissues the same cookie for a duplicate tab after the claim was reserved', async () => {
    const repo = repository({
      createClaim: vi.fn(async (input: Parameters<EnrollmentClaimRepository['createClaim']>[0]) => ({
        id: 'claim_1', codeId: input.codeId, codeVersion: input.codeVersion,
        source: input.source, status: 'reserved' as const, email: 'user@example.com',
        userId: null, expiresAt: input.expiresAt,
        reservationExpiresAt: new Date(now.getTime() + 60_000),
      })),
    });

    await expect(claimEnrollmentCode({
      repository: repo,
      code,
      pepper,
      idempotencyKey: 'attempt-12345678',
      id: 'claim_2',
      now,
    })).resolves.toMatchObject({ status: 'pending' });
  });

  it('reserves capacity atomically and exposes a capacity error', async () => {
    const repo = repository({ reserveClaim: vi.fn(async () => ({ outcome: 'capacity_full' as const })) });
    await expect(reserveEnrollmentClaim({
      repository: repo,
      claimToken,
      email: ' User@Example.com ',
      now,
    })).rejects.toMatchObject({ code: 'BETA_USER_CAP_REACHED', status: 409 });
    expect(repo.reserveClaim).toHaveBeenCalledWith(expect.objectContaining({
      email: 'user@example.com',
      capacity: MAX_ACTIVE_ENROLLMENT_USERS,
      now,
    }));
  });

  it('rejects an identity that does not match an already-bound claim', async () => {
    const repo = repository({ reserveClaim: vi.fn(async () => ({ outcome: 'email_mismatch' as const })) });
    await expect(reserveEnrollmentClaim({
      repository: repo,
      claimToken,
      email: 'other@example.com',
      now,
    })).rejects.toMatchObject({ code: 'ENROLLMENT_IDENTITY_MISMATCH', status: 403 });
  });

  it('keeps completion idempotent across retries', async () => {
    const repo = repository({ completeClaim: vi.fn(async () => ({ outcome: 'already_completed' as const, claimId: 'claim_1' })) });
    await expect(completeEnrollmentClaim({
      repository: repo,
      claimToken,
      userId: 'user_1',
      now,
    })).resolves.toEqual({ completed: true, replayed: true, claimId: 'claim_1' });
  });

  it('rotates the code and reports how many pending claims were revoked', async () => {
    const repo = repository();
    const result = await rotateEnrollmentCode({
      repository: repo,
      actorUserId: 'owner_1',
      pepper,
      now,
      entropy: new Uint8Array(13),
      id: 'code_2',
    });
    expect(result.code).toMatch(/^JOIN(?:-[0-9A-Z]{5}){4}$/);
    expect(result.revokedClaims).toBe(2);
    expect(repo.rotateCode).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'owner_1',
      codeId: 'code_2',
      reason: 'owner_rotation',
    }));
    expect(result.version).toBe(2);
  });

  it('maps an existing active code to the expected domain conflict', async () => {
    const repo = repository({
      createCode: vi.fn(async () => ({ outcome: 'active_exists' as const })),
    });

    await expect(createInitialEnrollmentCode({
      repository: repo,
      actorUserId: 'owner_1',
      pepper,
      id: 'code_1',
      auditEventId: 'audit_1',
      entropy: new Uint8Array(13),
      now,
    })).rejects.toMatchObject({
      code: 'ENROLLMENT_CODE_ALREADY_ACTIVE',
      status: 409,
    });
  });

  it('disables the active code idempotently and reports revoked unfinished claims', async () => {
    const repo = repository();
    await expect(revokeEnrollmentCode({
      repository: repo,
      actorUserId: 'owner_1',
      auditEventId: 'audit_1',
      now,
    })).resolves.toEqual({ changed: true, revokedClaims: 2 });
    expect(repo.revokeCode).toHaveBeenCalledWith({
      actorUserId: 'owner_1',
      auditEventId: 'audit_1',
      reason: 'owner_disabled',
      now,
    });

    const alreadyDisabled = repository({
      revokeCode: vi.fn(async () => ({ outcome: 'no_active_code' as const })),
    });
    await expect(revokeEnrollmentCode({
      repository: alreadyDisabled,
      actorUserId: 'owner_1',
      auditEventId: 'audit_2',
      now,
    })).resolves.toEqual({ changed: false, revokedClaims: 0 });
  });

  it('preserves AppError semantics for repository decisions', async () => {
    const repo = repository({ reserveClaim: vi.fn(async () => ({ outcome: 'invalid' as const })) });
    const error = await reserveEnrollmentClaim({
      repository: repo,
      claimToken,
      email: 'user@example.com',
      now,
    }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'INVALID_ENROLLMENT_CLAIM', status: 400 });
  });
});
