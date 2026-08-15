import { describe, expect, it, vi } from 'vitest';

import { createEnrollmentRepository } from './repository';

function queryHarness(rows: unknown[] = []) {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const client = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({ text: strings.join('?'), values });
    return rows;
  });
  return { client, queries };
}

function transactionHarness(results: unknown[][]) {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const capture = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = { text: strings.join('?'), values };
    queries.push(query);
    return query;
  };
  const transaction = vi.fn(async (
    build: (query: typeof capture) => Array<{ text: string; values: unknown[] }>,
  ) => {
    build(capture);
    return results;
  });
  return { client: Object.assign(vi.fn(), { transaction }), queries, transaction };
}

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function expectExactCapacityInvariant(sql: string): void {
  const match = sql.match(
    /capacity AS MATERIALIZED \(([\s\S]*?)\),\s+(?:decision|eligible) AS MATERIALIZED \(/,
  );
  expect(match, 'expected a materialized enrollment capacity calculation').not.toBeNull();

  const capacitySql = compactSql(match?.[1] ?? '');
  expect(capacitySql).toMatch(
    /FROM "user"(?: AS [a-z_]+)? WHERE (?:[a-z_]+\.)?"status" = 'active'::"UserStatus"/,
  );
  expect(capacitySql).toMatch(
    /FROM "Invitation" AS live_invitation WHERE \( live_invitation\."status" = 'pending'::"InvitationStatus" OR \( live_invitation\."status" = 'accepted'::"InvitationStatus" AND live_invitation\."acceptedByUserId" IS NULL \) \) AND live_invitation\."expiresAt" > \? AND NOT EXISTS \( SELECT 1 FROM "EnrollmentClaim" AS legacy_claim WHERE legacy_claim\."sourceReferenceId" = live_invitation\."id" AND legacy_claim\."source" IN \('legacy_invitation', 'bootstrap'\) AND legacy_claim\."status" = 'reserved'::"EnrollmentClaimStatus" AND legacy_claim\."reservationExpiresAt" > \? AND legacy_claim\."expiresAt" > \? \)/,
  );
  expect(capacitySql).toMatch(
    /FROM "EnrollmentClaim" AS reserved_claim WHERE reserved_claim\."status" = 'reserved'::"EnrollmentClaimStatus" AND reserved_claim\."reservationExpiresAt" > \? AND reserved_claim\."expiresAt" > \?/,
  );
  expect(capacitySql).not.toContain(`'pending'::"EnrollmentClaimStatus"`);
  expect(capacitySql).not.toContain(`'completed'::"EnrollmentClaimStatus"`);
}

const now = new Date('2026-08-09T00:00:00.000Z');

describe('enrollment repository', () => {
  it('looks up an active code by HMAC without returning its stored hash', async () => {
    const harness = queryHarness([{ id: 'code_1', version: 1, codePrefix: '01234567', status: 'active' }]);
    const repository = createEnrollmentRepository({ $client: harness.client } as never);

    await expect(repository.findActiveCodeByHash({ codeHash: 'a'.repeat(64), now }))
      .resolves.toEqual({ id: 'code_1', version: 1, codePrefix: '01234567', status: 'active' });
    expect(harness.queries[0]?.text).toMatch(/FROM "EnrollmentCode"/);
    expect(harness.queries[0]?.text).toMatch(/"status" = 'active'/);
    expect((harness.queries[0]?.text ?? '').split('FROM')[0]).not.toContain('"codeHash"');
    expect(harness.queries[0]?.values).toContain('a'.repeat(64));
  });

  it('creates a pending claim only while the matching code version remains active', async () => {
    const harness = queryHarness([{
      id: 'claim_1', codeId: 'code_1', codeVersion: 1, source: 'shared_code',
      status: 'pending', email: null, userId: null, expiresAt: now,
      reservationExpiresAt: null,
    }]);
    const repository = createEnrollmentRepository({ $client: harness.client } as never);

    await repository.createClaim({
      id: 'claim_1', tokenHash: 'b'.repeat(64), tokenPrefix: 'AAAAAAAA',
      codeId: 'code_1', codeVersion: 1, source: 'shared_code',
      idempotencyKeyHash: null, expiresAt: now, now,
    });

    const sql = harness.queries[0]?.text ?? '';
    expect(sql).toMatch(/INSERT INTO "EnrollmentClaim"/);
    expect(sql).toMatch(/FROM "EnrollmentCode"/);
    expect(sql).toMatch(/"version" =/);
    expect(sql).toMatch(/"status" = 'active'/);
    expect(sql).toMatch(/'pending'::"EnrollmentClaimStatus"/);
  });

  it('adapts a live legacy invitation into a retryable claim without storing its raw token', async () => {
    const harness = queryHarness([{
      id: 'legacy_claim_1', codeId: null, codeVersion: null, source: 'legacy_invitation',
      status: 'pending', email: 'invited@example.com', userId: null, expiresAt: now,
      reservationExpiresAt: null,
    }]);
    const repository = createEnrollmentRepository({ $client: harness.client } as never);

    await repository.createLegacyClaim({
      id: 'legacy_claim_1', tokenHash: 'a'.repeat(64), tokenPrefix: 'AAAAAAAA',
      invitationTokenHash: 'b'.repeat(64), expiresAt: now, now,
    });

    const sql = harness.queries[0]?.text ?? '';
    expect(sql).toMatch(/FROM "Invitation"/);
    expect(sql).toMatch(/'legacy_invitation'::"EnrollmentClaimSource"/);
    expect(sql).toMatch(/'bootstrap'::"EnrollmentClaimSource"/);
    expect(sql).toMatch(/INSERT INTO "EnrollmentClaim"/);
    expect(sql).toMatch(/UPDATE "Invitation"[\s\S]*"status" = 'accepted'/);
    expect(harness.queries[0]?.values).toContain('b'.repeat(64));
  });

  it('reactivates the deterministic legacy claim after claim expiry and caps renewal at invitation expiry', async () => {
    const renewedExpiry = new Date(now.getTime() + 15 * 60_000);
    const harness = queryHarness([{
      id: 'legacy_claim_1', codeId: null, codeVersion: null, source: 'legacy_invitation',
      status: 'pending', email: 'invited@example.com', userId: null, expiresAt: renewedExpiry,
      reservationExpiresAt: null,
    }]);
    const repository = createEnrollmentRepository({ $client: harness.client } as never);

    await repository.createLegacyClaim({
      id: 'legacy_claim_retry', tokenHash: 'a'.repeat(64), tokenPrefix: 'AAAAAAAA',
      invitationTokenHash: 'b'.repeat(64), expiresAt: renewedExpiry, now,
    });

    const sql = compactSql(harness.queries[0]?.text ?? '');
    expect(sql).toContain('ON CONFLICT ("tokenHash") DO UPDATE');
    expect(sql).toMatch(
      /DO UPDATE SET "status" = 'pending'::"EnrollmentClaimStatus"[\s\S]*"expiresAt" = EXCLUDED\."expiresAt"/,
    );
    expect(sql).toMatch(
      /"EnrollmentClaim"\."sourceReferenceId" = EXCLUDED\."sourceReferenceId"[\s\S]*"EnrollmentClaim"\."status" IN \('pending'::"EnrollmentClaimStatus", 'expired'::"EnrollmentClaimStatus"\)/,
    );
    expect(sql).toContain('LEAST(candidate."expiresAt", ?)');
    expect(harness.queries[0]?.values).toContain(renewedExpiry);
  });

  it('reactivates no completed or revoked claim and no revoked, bound, or expired invitation', async () => {
    const harness = queryHarness([]);
    const repository = createEnrollmentRepository({ $client: harness.client } as never);

    await repository.createLegacyClaim({
      id: 'legacy_claim_retry', tokenHash: 'a'.repeat(64), tokenPrefix: 'AAAAAAAA',
      invitationTokenHash: 'b'.repeat(64), expiresAt: new Date(now.getTime() + 15 * 60_000), now,
    });

    const sql = compactSql(harness.queries[0]?.text ?? '');
    expect(sql).toMatch(
      /invitation\."status" IN \('pending'::"InvitationStatus", 'accepted'::"InvitationStatus"\)/,
    );
    expect(sql).toContain('invitation."expiresAt" > ?');
    expect(sql).toContain('invitation."acceptedByUserId" IS NULL');
    expect(sql).toMatch(
      /"EnrollmentClaim"\."status" IN \('pending'::"EnrollmentClaimStatus", 'expired'::"EnrollmentClaimStatus"\)/,
    );
    expect(sql).not.toMatch(
      /"EnrollmentClaim"\."status" IN \([^)]*(?:'completed'|'revoked')/,
    );
  });

  it('reactivates a stale reserved legacy claim whose claim expiry has elapsed', async () => {
    const renewedExpiry = new Date(now.getTime() + 15 * 60_000);
    const harness = queryHarness([{
      id: 'legacy_claim_1', codeId: null, codeVersion: null, source: 'legacy_invitation',
      status: 'pending', email: 'invited@example.com', userId: null, expiresAt: renewedExpiry,
      reservationExpiresAt: null,
    }]);
    const repository = createEnrollmentRepository({ $client: harness.client } as never);

    await repository.createLegacyClaim({
      id: 'legacy_claim_retry', tokenHash: 'a'.repeat(64), tokenPrefix: 'AAAAAAAA',
      invitationTokenHash: 'b'.repeat(64), expiresAt: renewedExpiry, now,
    });

    const sql = compactSql(harness.queries[0]?.text ?? '');
    expect(sql).toMatch(
      /"EnrollmentClaim"\."status" = 'reserved'::"EnrollmentClaimStatus"[\s\S]*"EnrollmentClaim"\."expiresAt" <= \?/,
    );
    expect(sql).toMatch(
      /DO UPDATE SET "status" = 'pending'::"EnrollmentClaimStatus"[\s\S]*"reservationExpiresAt" = NULL/,
    );
  });

  it('reserves capacity under one advisory lock using the exact three-term invariant', async () => {
    const harness = transactionHarness([
      [],
      [{ outcome: 'reserved', claimId: 'claim_1', userId: null }],
    ]);
    const repository = createEnrollmentRepository({ $client: harness.client } as never);

    await expect(repository.reserveClaim({
      claimTokenHash: 'c'.repeat(64), email: 'user@example.com', capacity: 10,
      reservationExpiresAt: new Date(now.getTime() + 300_000), now,
    })).resolves.toEqual({ outcome: 'reserved', claimId: 'claim_1' });

    const sql = harness.queries.map((query) => query.text).join('\n');
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expectExactCapacityInvariant(sql);
  });

  it('finalizes activation, personal workspace, membership, claim, and audit atomically', async () => {
    const harness = transactionHarness([
      [],
      [{ outcome: 'completed', claimId: 'claim_1', workspaceId: 'workspace_1' }],
    ]);
    const repository = createEnrollmentRepository({ $client: harness.client } as never);

    await expect(repository.completeClaim({
      claimTokenHash: 'd'.repeat(64), userId: 'user_1', workspaceId: 'workspace_1',
      workspaceAccessKeyHash: 'e'.repeat(64), workspaceAccessKeyPrefix: 'acct_eeeeeeee',
      auditEventId: 'audit_1', capacity: 10, now,
    })).resolves.toEqual({ outcome: 'completed', claimId: 'claim_1', workspaceId: 'workspace_1' });

    const sql = harness.queries.map((query) => query.text).join('\n');
    expect(sql).toMatch(/UPDATE "user"[\s\S]*"status" = 'active'/);
    expect(sql).toMatch(/INSERT INTO "Workspace"/);
    expect(sql).toMatch(/INSERT INTO "WorkspaceMember"/);
    expect(sql).toMatch(/UPDATE "EnrollmentClaim"[\s\S]*"status" = 'completed'/);
    expect(sql).toMatch(/INSERT INTO "AuditEvent"/);
    expect(sql).toMatch(/eligible\."source" = 'bootstrap'/);
    expect(sql).toMatch(/UPDATE "Invitation"[\s\S]*"acceptedByUserId"/);
    expectExactCapacityInvariant(sql);
  });

  it('rotates linearly and revokes all pending or reserved claims on the old version', async () => {
    const harness = transactionHarness([
      [],
      [{ id: 'code_1', version: 1 }],
      [{ version: 2, revokedCodeId: 'code_1', revokedClaims: 3 }],
    ]);
    const repository = createEnrollmentRepository({ $client: harness.client } as never);

    await expect(repository.rotateCode({
      codeId: 'code_2', codeHash: 'f'.repeat(64), codePrefix: 'ZZZZZZZZ',
      actorUserId: 'owner_1', auditEventId: 'audit_1', reason: 'owner_rotation', now,
    })).resolves.toEqual({ version: 2, revokedCodeId: 'code_1', revokedClaims: 3 });

    const sql = harness.queries.map((query) => query.text).join('\n');
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(harness.queries[1]?.text).toMatch(/FROM "EnrollmentCode"[\s\S]*FOR UPDATE/);
    expect(sql).toMatch(/UPDATE "EnrollmentCode"[\s\S]*"status" = 'revoked'/);
    expect(sql).toMatch(/UPDATE "EnrollmentClaim"[\s\S]*"status" IN \('pending', 'reserved'\)/);
    expect(sql).toMatch(/INSERT INTO "EnrollmentCode"/);
    expect(sql).toMatch(/INSERT INTO "AuditEvent"/);
  });

  it('disables the active code without replacement and revokes only its unfinished shared claims', async () => {
    const harness = transactionHarness([
      [],
      [{ id: 'code_1', version: 1 }],
      [{ outcome: 'revoked', revokedCodeId: 'code_1', revokedClaims: 3 }],
    ]);
    const repository = createEnrollmentRepository({ $client: harness.client } as never);

    await expect(repository.revokeCode({
      actorUserId: 'owner_1', auditEventId: 'audit_1', reason: 'owner_disabled', now,
    })).resolves.toEqual({
      outcome: 'revoked', revokedCodeId: 'code_1', revokedClaims: 3,
    });

    expect(harness.queries).toHaveLength(3);
    expect(harness.queries[0]?.text).toMatch(/pg_advisory_xact_lock/);
    expect(harness.queries[1]?.text).toMatch(/FROM "EnrollmentCode"[\s\S]*"status" = 'active'[\s\S]*FOR UPDATE/);
    const mutationSql = harness.queries[2]?.text ?? '';
    expect(mutationSql).toMatch(/UPDATE "EnrollmentCode"[\s\S]*"status" = 'revoked'/);
    expect(mutationSql).toMatch(/UPDATE "EnrollmentClaim"[\s\S]*claim\."source" = 'shared_code'/);
    expect(mutationSql).toMatch(/claim\."status" IN \('pending', 'reserved'\)/);
    expect(mutationSql).toMatch(/"reservationExpiresAt" = NULL/);
    expect(mutationSql).toMatch(/"failureCode" = 'code_revoked'/);
    expect(mutationSql).toMatch(/'enrollment\.code_revoked'/);
    expect(mutationSql).not.toMatch(/INSERT INTO "EnrollmentCode"/);
  });

  it('releases only the matching live reservation back to pending', async () => {
    const harness = queryHarness([{ id: 'claim_1' }]);
    const repository = createEnrollmentRepository({ $client: harness.client } as never);
    await expect(repository.releaseClaim({
      claimTokenHash: 'a'.repeat(64), email: 'user@example.com', now,
    })).resolves.toBe(true);
    const sql = harness.queries[0]?.text ?? '';
    expect(sql).toMatch(/"status" = 'pending'/);
    expect(sql).toMatch(/"status" = 'reserved'/);
    expect(sql).toMatch(/lower\(claim\."email"\) =/);
    expect(sql).toMatch(/FROM "Invitation"/);
    expect(sql).toMatch(/claim\."source" IN \('legacy_invitation', 'bootstrap'\)/);
  });
});
