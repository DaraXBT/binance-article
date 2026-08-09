import { describe, expect, it, vi } from 'vitest';

import { ENROLLMENT_CAPACITY_LOCK_KEY } from '@/server/modules/enrollment/repository';

import { createInvitationAdminRepository } from './repository';

function transactionHarness(results: unknown[][]) {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const capture = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = { text: strings.join('?'), values };
    queries.push(query);
    return query;
  };
  const transaction = vi.fn(async (
    build: (query: typeof capture) => Array<{ text: string; values: unknown[] }>,
    options?: unknown,
  ) => {
    build(capture);
    return results;
  });
  return { client: Object.assign(vi.fn(), { transaction }), queries, transaction };
}

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

const now = new Date('2026-08-09T00:00:00.000Z');

describe('invitation administration repository', () => {
  it('issues invitations under the shared lock using the exact enrollment capacity invariant', async () => {
    const harness = transactionHarness([
      [],
      [{ result: 'created', id: 'invite_1' }],
    ]);
    const repository = createInvitationAdminRepository({ $client: harness.client } as never);

    await expect(repository.insertWithinCapacity({
      id: 'invite_1',
      email: 'invited@example.com',
      tokenHash: 'a'.repeat(64),
      tokenPrefix: 'AAAAAAAA',
      createdByUserId: 'owner_1',
      expiresAt: new Date(now.getTime() + 60_000),
      now,
    }, 10)).resolves.toBe('created');

    expect(harness.queries).toHaveLength(2);
    expect(harness.queries[0]?.text).toContain('pg_advisory_xact_lock');
    expect(harness.queries[0]?.values).toContain(ENROLLMENT_CAPACITY_LOCK_KEY);

    const sql = compactSql(harness.queries[1]?.text ?? '');
    expect(sql).toMatch(/FROM "user"[\s\S]*"status" = 'active'::"UserStatus"/);
    expect(sql).toMatch(
      /FROM "Invitation" AS live_invitation[\s\S]*live_invitation\."status" = 'pending'::"InvitationStatus"[\s\S]*live_invitation\."status" = 'accepted'::"InvitationStatus"[\s\S]*live_invitation\."acceptedByUserId" IS NULL/,
    );
    expect(sql).toMatch(/live_invitation\."expiresAt" >/);
    expect(sql).toMatch(
      /NOT EXISTS[\s\S]*FROM "EnrollmentClaim" AS legacy_claim[\s\S]*legacy_claim\."sourceReferenceId" = live_invitation\."id"[\s\S]*legacy_claim\."source" IN \('legacy_invitation', 'bootstrap'\)[\s\S]*legacy_claim\."status" = 'reserved'::"EnrollmentClaimStatus"[\s\S]*legacy_claim\."reservationExpiresAt" >[\s\S]*legacy_claim\."expiresAt" >/,
    );
    expect(sql).toMatch(
      /FROM "EnrollmentClaim" AS reserved_claim[\s\S]*reserved_claim\."status" = 'reserved'::"EnrollmentClaimStatus"[\s\S]*reserved_claim\."reservationExpiresAt" >[\s\S]*reserved_claim\."expiresAt" >/,
    );
    expect(sql).not.toContain(`'pending'::"EnrollmentClaimStatus"`);
    expect(sql).not.toContain(`'completed'::"EnrollmentClaimStatus"`);
    expect(harness.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'ReadCommitted',
    });
  });

  it('atomically revokes pending or accepted-unbound invitations and unfinished linked claims', async () => {
    const harness = transactionHarness([
      [],
      [{ revoked: true }],
    ]);
    const repository = createInvitationAdminRepository({ $client: harness.client } as never);

    await expect(repository.revoke({
      invitationId: 'invite_1',
      actorUserId: 'owner_1',
      now,
    })).resolves.toBe(true);

    expect(harness.queries).toHaveLength(2);
    expect(harness.queries[0]?.text).toContain('pg_advisory_xact_lock');
    expect(harness.queries[0]?.values).toContain(ENROLLMENT_CAPACITY_LOCK_KEY);

    const sql = harness.queries[1]?.text ?? '';
    expect(sql).toMatch(
      /FROM "Invitation"[\s\S]*"status" = 'pending'::"InvitationStatus"[\s\S]*"status" = 'accepted'::"InvitationStatus"[\s\S]*"acceptedByUserId" IS NULL[\s\S]*FOR UPDATE/,
    );
    expect(sql).toMatch(
      /UPDATE "EnrollmentClaim" AS claim[\s\S]*"status" = 'revoked'::"EnrollmentClaimStatus"[\s\S]*"reservationExpiresAt" = NULL[\s\S]*"revokedAt" =[\s\S]*"failureCode" = 'invitation_revoked'[\s\S]*claim\."sourceReferenceId" = target\."id"[\s\S]*claim\."source" IN \('legacy_invitation', 'bootstrap'\)[\s\S]*claim\."status" IN \(\s*'pending'::"EnrollmentClaimStatus",\s*'reserved'::"EnrollmentClaimStatus"\s*\)/,
    );
    expect(sql).toMatch(
      /UPDATE "Invitation" AS target_invitation[\s\S]*"status" = 'revoked'::"InvitationStatus"[\s\S]*"revokedAt" =/,
    );
    expect(harness.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'ReadCommitted',
    });
  });

  it('reports a missing or already-bound invitation as not revoked', async () => {
    const harness = transactionHarness([[], [{ revoked: false }]]);
    const repository = createInvitationAdminRepository({ $client: harness.client } as never);

    await expect(repository.revoke({
      invitationId: 'invite_bound',
      actorUserId: 'owner_1',
      now,
    })).resolves.toBe(false);
  });
});
