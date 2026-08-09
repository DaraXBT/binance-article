import { describe, expect, it, vi } from 'vitest';

import { ENROLLMENT_CAPACITY_LOCK_KEY } from '@/server/modules/enrollment/repository';

import { createEnrollmentAdminRepository } from './repository';

type CapturedQuery = { text: string; values: unknown[] };

function queryHarness(rows: unknown[] = []) {
  const queries: CapturedQuery[] = [];
  const client = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({ text: strings.join('?'), values });
    return rows;
  });
  return { client, queries };
}

function transactionHarness(results: unknown[][]) {
  const queries: CapturedQuery[] = [];
  const capture = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = { text: strings.join('?'), values };
    queries.push(query);
    return query;
  };
  const transaction = vi.fn(async (
    build: (query: typeof capture) => CapturedQuery[],
    options?: unknown,
  ) => {
    build(capture);
    return results;
  });
  return { client: Object.assign(vi.fn(), { transaction }), queries, transaction };
}

const now = new Date('2026-08-09T00:00:00.000Z');

async function captureStatusMutation(
  action: 'suspend' | 'revoke' | 'restore',
  status: 'active' | 'suspended' | 'revoked' = action === 'restore' ? 'active' : action === 'suspend' ? 'suspended' : 'revoked',
) {
  const harness = transactionHarness([
    [],
    [{ outcome: 'updated', status }],
  ]);
  const repository = createEnrollmentAdminRepository({ $client: harness.client } as never);

  await expect(repository.updatePersonStatus({
    actorUserId: 'owner_1',
    userId: 'user_1',
    action,
    now,
    capacity: 10,
    auditEventId: 'audit_1',
  })).resolves.toEqual({ outcome: 'updated', status });

  expect(harness.queries).toHaveLength(2);
  return {
    harness,
    sql: harness.queries[1]?.text ?? '',
    compactSql: (harness.queries[1]?.text ?? '').replace(/\s+/g, ' ').trim(),
  };
}

function cteBody(sql: string, start: string, end: string): string {
  const startIndex = sql.indexOf(start);
  const endIndex = sql.indexOf(end, startIndex + start.length);
  expect(startIndex, `missing ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing ${end}`).toBeGreaterThan(startIndex);
  return sql.slice(startIndex, endIndex);
}

describe('enrollment people administration repository', () => {
  it('reports all three seat categories using the exact capacity invariant', async () => {
    const harness = queryHarness([{
      codeVersion: null,
      activeUsers: 3,
      legacyInvitations: 2,
      reservedClaims: 1,
    }]);
    const repository = createEnrollmentAdminRepository({ $client: harness.client } as never);

    await expect(repository.getOverview({ now, limit: 10 })).resolves.toEqual({
      code: null,
      capacity: {
        activeUsers: 3,
        legacyInvitations: 2,
        reservedClaims: 1,
        limit: 10,
      },
    });

    const sql = harness.queries[0]?.text ?? '';
    expect(sql).toMatch(/FROM "user"[\s\S]*"status" = 'active'::"UserStatus"/);
    expect(sql).toMatch(
      /FROM "Invitation" AS live_invitation[\s\S]*live_invitation\."status" = 'pending'::"InvitationStatus"[\s\S]*live_invitation\."status" = 'accepted'::"InvitationStatus"[\s\S]*live_invitation\."acceptedByUserId" IS NULL/,
    );
    expect(sql).toMatch(/live_invitation\."expiresAt" >/);
    expect(sql).toMatch(
      /NOT EXISTS[\s\S]*FROM "EnrollmentClaim" AS legacy_claim[\s\S]*legacy_claim\."sourceReferenceId" = live_invitation\."id"[\s\S]*legacy_claim\."status" = 'reserved'::"EnrollmentClaimStatus"[\s\S]*legacy_claim\."reservationExpiresAt" >[\s\S]*legacy_claim\."expiresAt" >/,
    );
    expect(sql).toMatch(
      /FROM "EnrollmentClaim" AS reserved_claim[\s\S]*reserved_claim\."status" = 'reserved'::"EnrollmentClaimStatus"[\s\S]*reserved_claim\."reservationExpiresAt" >[\s\S]*reserved_claim\."expiresAt" >/,
    );
  });

  it('permits restore from suspended or revoked and rejects every other source state', async () => {
    const { compactSql } = await captureStatusMutation('restore');
    const invalidRestore = compactSql.match(
      /WHEN \? = 'restore' AND EXISTS \((.*?)\) THEN 'invalid_transition'/,
    )?.[1] ?? '';

    expect(invalidRestore).toContain('FROM target');
    expect(invalidRestore).toContain('"status" NOT IN');
    expect(invalidRestore).toContain('\'suspended\'::"UserStatus"');
    expect(invalidRestore).toContain('\'revoked\'::"UserStatus"');
  });

  it('checks the exact locked ten-seat invariant on every restore even when a workspace is retained', async () => {
    const { harness, sql, compactSql } = await captureStatusMutation('restore');

    expect(harness.queries[0]?.text).toContain('pg_advisory_xact_lock');
    expect(harness.queries[0]?.values).toContain(ENROLLMENT_CAPACITY_LOCK_KEY);
    expect(harness.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'ReadCommitted',
    });

    expect(sql).toMatch(/FROM "user"[\s\S]*"status" = 'active'::"UserStatus"/);
    expect(sql).toMatch(
      /FROM "Invitation" AS live_invitation[\s\S]*live_invitation\."status" = 'pending'::"InvitationStatus"[\s\S]*live_invitation\."status" = 'accepted'::"InvitationStatus"[\s\S]*live_invitation\."acceptedByUserId" IS NULL/,
    );
    expect(sql).toMatch(/live_invitation\."expiresAt" >/);
    expect(sql).toMatch(
      /NOT EXISTS[\s\S]*FROM "EnrollmentClaim" AS legacy_claim[\s\S]*legacy_claim\."sourceReferenceId" = live_invitation\."id"[\s\S]*legacy_claim\."status" = 'reserved'::"EnrollmentClaimStatus"[\s\S]*legacy_claim\."reservationExpiresAt" >[\s\S]*legacy_claim\."expiresAt" >/,
    );
    expect(sql).toMatch(
      /FROM "EnrollmentClaim" AS reserved_claim[\s\S]*reserved_claim\."status" = 'reserved'::"EnrollmentClaimStatus"[\s\S]*reserved_claim\."reservationExpiresAt" >[\s\S]*reserved_claim\."expiresAt" >/,
    );

    const capacityOutcomeIndex = compactSql.indexOf("THEN 'capacity_full'");
    const capacityGuardStart = compactSql.lastIndexOf('WHEN', capacityOutcomeIndex);
    const capacityGuard = compactSql.slice(capacityGuardStart, capacityOutcomeIndex);
    expect(capacityOutcomeIndex).toBeGreaterThanOrEqual(0);
    expect(capacityGuard).toContain("? = 'restore'");
    expect(capacityGuard).toContain('>= ?');
    expect(capacityGuard).not.toContain('target_workspace');
  });

  it('allows owner suspension or revocation only when a different active owner remains', async () => {
    const { compactSql } = await captureStatusMutation('suspend');

    expect(compactSql).not.toMatch(
      /WHEN EXISTS \(SELECT 1 FROM target WHERE "role" = 'owner'::"UserRole"\) THEN 'owner'/,
    );

    const lastOwnerOutcomeIndex = compactSql.indexOf("THEN 'last_owner'");
    const lastOwnerGuardStart = compactSql.lastIndexOf('WHEN', lastOwnerOutcomeIndex);
    const lastOwnerGuard = compactSql.slice(lastOwnerGuardStart, lastOwnerOutcomeIndex);
    expect(lastOwnerOutcomeIndex).toBeGreaterThanOrEqual(0);
    expect(lastOwnerGuard).toContain("? IN ('suspend', 'revoke')");
    expect(lastOwnerGuard).toContain('\'owner\'::"UserRole"');
    expect(lastOwnerGuard).toContain('\'active\'::"UserStatus"');
    expect(lastOwnerGuard).toMatch(/"id"\s*<>/);
  });

  it('deletes account sessions only for suspend or revoke mutations', async () => {
    const { compactSql } = await captureStatusMutation('restore');
    const invalidatedSessions = cteBody(
      compactSql,
      'invalidated_sessions AS (',
      '), revoked_devices AS (',
    );

    expect(invalidatedSessions).toContain('DELETE FROM "session"');
    expect(invalidatedSessions).toMatch(
      /(?:\? IN \('suspend', 'revoke'\)|updated\."status" IN \('suspended'::"UserStatus", 'revoked'::"UserStatus"\))/,
    );
  });

  it('revokes unfinished claims by normalized target email even before a user id is bound', async () => {
    const { compactSql } = await captureStatusMutation('revoke');
    const revokedClaims = cteBody(
      compactSql,
      'revoked_claims AS (',
      '), audit_event AS (',
    );

    expect(revokedClaims).toContain('UPDATE "EnrollmentClaim" AS claim');
    expect(revokedClaims).toMatch(
      /claim\."userId" = updated\."id" OR lower\(claim\."email"\) = lower\(updated\."email"\)/,
    );
    expect(revokedClaims).toContain("claim.\"status\" IN ('pending', 'reserved')");
  });

  it('retains workspace data while revoking publisher devices without reactivating them on restore', async () => {
    const { compactSql } = await captureStatusMutation('restore');
    const revokedDevices = cteBody(
      compactSql,
      'revoked_devices AS (',
      '), revoked_claims AS (',
    );

    expect(compactSql).not.toMatch(/(?:DELETE FROM|UPDATE) "Workspace"/);
    expect(compactSql).not.toMatch(/(?:DELETE FROM|UPDATE) "WorkspaceMember"/);
    expect(revokedDevices).toContain('UPDATE "PublisherDevice" AS device');
    expect(revokedDevices).toContain("? IN ('suspend', 'revoke')");
    expect(revokedDevices).toContain('\'revoked\'::"PublisherDeviceStatus"');
    expect(revokedDevices).not.toContain('\'active\'::"PublisherDeviceStatus"');
  });
});
