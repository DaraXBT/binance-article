import { describe, expect, it, vi } from 'vitest';

import { AppError } from '@/server/http/errors';

import {
  ENROLLMENT_CLAIM_TTL_MS,
  MAX_ACTIVE_ENROLLMENT_USERS,
  claimEnrollmentCode,
  completeEnrollmentClaim,
  reserveEnrollmentClaim,
  rotateEnrollmentCode,
} from './service';

const now = new Date('2026-08-09T00:00:00.000Z');
const pepper = 'pepper'.repeat(8);
const code = 'JOIN-01234-56789-ABCDE-FGHJK';

function repository(overrides: Record<string, unknown> = {}) {
  return {
    findActiveCodeByHash: vi.fn(async () => ({
      id: 'code_1', version: 1, codePrefix: '01234567', status: 'active' as const,
    })),
    createClaim: vi.fn(async (input: Record<string, unknown>) => ({
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
    reserveClaim: vi.fn(async () => ({ outcome: 'reserved' as const, claimId: 'claim_1' })),
    completeClaim: vi.fn(async () => ({ outcome: 'completed' as const, claimId: 'claim_1' })),
    rotateCode: vi.fn(async () => ({ revokedCodeId: 'code_1', revokedClaims: 2 })),
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
      entropy: new Uint8Array(13),
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

  it('reserves capacity atomically and exposes a capacity error', async () => {
    const repo = repository({ reserveClaim: vi.fn(async () => ({ outcome: 'capacity_full' as const })) });
    await expect(reserveEnrollmentClaim({
      repository: repo,
      claimToken: 'claim-token-for-test-1234567890',
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
      claimToken: 'claim-token-for-test-1234567890',
      email: 'other@example.com',
      now,
    })).rejects.toMatchObject({ code: 'ENROLLMENT_IDENTITY_MISMATCH', status: 403 });
  });

  it('keeps completion idempotent across retries', async () => {
    const repo = repository({ completeClaim: vi.fn(async () => ({ outcome: 'already_completed' as const, claimId: 'claim_1' })) });
    await expect(completeEnrollmentClaim({
      repository: repo,
      claimToken: 'claim-token-for-test-1234567890',
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
      codeVersion: 1,
    }));
  });

  it('preserves AppError semantics for repository decisions', async () => {
    const repo = repository({ reserveClaim: vi.fn(async () => ({ outcome: 'invalid' as const })) });
    const error = await reserveEnrollmentClaim({
      repository: repo,
      claimToken: 'claim-token-for-test-1234567890',
      email: 'user@example.com',
      now,
    }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'INVALID_ENROLLMENT_CLAIM', status: 400 });
  });
});
