import { describe, expect, it, vi } from 'vitest';

import { createLegacyWorkspaceClaimRepository } from './legacy-claim-repository';

type ClaimResult = {
  id: string;
  replacedWorkspace: boolean;
};

type CapturedQuery = {
  text: string;
  values: unknown[];
};

function repositoryHarness(result: ClaimResult | null) {
  const captured: CapturedQuery[] = [];
  const capture = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = { text: strings.join('?'), values };
    captured.push(query);
    return query;
  };
  const rows = result ? [result] : [];
  const client = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    capture(strings, ...values);
    return rows;
  });
  const transaction = vi.fn(async (
    build: (query: typeof capture) => CapturedQuery[],
    _options: unknown,
  ) => {
    const queries = build(capture);
    return queries.map((_query, index) => index === queries.length - 1 ? rows : []);
  });
  Object.assign(client, { transaction });

  return {
    database: { $client: client } as never,
    captured,
    client,
    transaction,
  };
}

function sqlFrom(captured: CapturedQuery[]): string {
  return captured.map((query) => query.text).join('\n');
}

describe('legacy workspace claim repository', () => {
  const input = {
    actorUserId: 'user_1',
    accessKeyHash: 'b'.repeat(64),
    auditEventId: 'audit_1',
    now: new Date('2026-07-20T00:00:00.000Z'),
  };

  it('returns whether an atomic claim attached directly or replaced a pristine account workspace', async () => {
    for (const expected of [
      { id: 'legacy_direct', replacedWorkspace: false },
      { id: 'legacy_replacement', replacedWorkspace: true },
    ]) {
      const harness = repositoryHarness(expected);
      const repository = createLegacyWorkspaceClaimRepository(harness.database);

      await expect(repository.claimByRecoveryHash(input)).resolves.toEqual(expected);
    }
  });

  it('shares the account provisioning lock and locks both workspaces in deterministic order', async () => {
    const harness = repositoryHarness({ id: 'legacy_replacement', replacedWorkspace: true });
    const repository = createLegacyWorkspaceClaimRepository(harness.database);
    await repository.claimByRecoveryHash(input);
    const sql = sqlFrom(harness.captured);

    expect(harness.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'ReadCommitted' },
    );
    expect(sql).toMatch(/pg_advisory_xact_lock[\s\S]*hashtextextended/);
    expect(sql).toMatch(/ORDER BY[\s\S]*\."id"[\s\S]*FOR UPDATE/);
    expect(harness.captured.flatMap((query) => query.values)).toContain(input.actorUserId);
  });

  it('directly claims only an unowned workspace explicitly classified as legacy', async () => {
    const harness = repositoryHarness({ id: 'legacy_direct', replacedWorkspace: false });
    const repository = createLegacyWorkspaceClaimRepository(harness.database);
    await repository.claimByRecoveryHash(input);
    const sql = sqlFrom(harness.captured);

    expect(sql).toMatch(/"origin"\s*=\s*'legacy'::"WorkspaceOrigin"/);
    expect(sql).toMatch(/"legacyClaimExpiresAt"[\s\S]*FOR UPDATE/);
    expect(sql).toMatch(/INSERT INTO "WorkspaceMember"/);
    expect(sql).toMatch(/'owner'::"WorkspaceMemberRole"/);
    expect(sql).toMatch(/NOT EXISTS[\s\S]*FROM "WorkspaceMember"/);
  });

  it('replaces only a sole-owner account placeholder with an exact acct prefix', async () => {
    const harness = repositoryHarness({ id: 'legacy_replacement', replacedWorkspace: true });
    const repository = createLegacyWorkspaceClaimRepository(harness.database);
    await repository.claimByRecoveryHash(input);
    const sql = sqlFrom(harness.captured);

    expect(sql).toMatch(/"origin"\s*=\s*'account'::"WorkspaceOrigin"/);
    expect(sql).toContain('^acct_[a-f0-9]{8}$');
    expect(sql).toMatch(/"role"\s*=\s*'owner'::"WorkspaceMemberRole"/);
    expect(sql).toMatch(/NOT EXISTS\s*\([\s\S]*FROM "WorkspaceMember"[\s\S]*"userId"\s*<>/);
    expect(sql).toMatch(/UPDATE "WorkspaceMember"[\s\S]*SET "workspaceId"/);
    expect(sql).toMatch(/DELETE FROM "Workspace"/);
  });

  it.each([
    'DeckProject',
    'JobRun',
    'UsageLedger',
    'StorageObject',
    'BinancePublicationDraft',
    'PublisherDevice',
    'WorkspaceSession',
    'WorkspaceAiCredential',
  ])('disqualifies replacement when the account workspace has durable rows in %s', async (table) => {
    const harness = repositoryHarness({ id: 'legacy_replacement', replacedWorkspace: true });
    const repository = createLegacyWorkspaceClaimRepository(harness.database);
    await repository.claimByRecoveryHash(input);
    const sql = sqlFrom(harness.captured);

    expect(sql).toMatch(new RegExp(
      `NOT EXISTS\\s*\\(\\s*SELECT 1\\s+FROM "${table}"[\\s\\S]*?"workspaceId"[\\s\\S]*?\\)`,
    ));
  });

  it('rebinds generation access grants before deleting the account placeholder', async () => {
    const harness = repositoryHarness({ id: 'legacy_replacement', replacedWorkspace: true });
    const repository = createLegacyWorkspaceClaimRepository(harness.database);
    await repository.claimByRecoveryHash(input);
    const sql = sqlFrom(harness.captured);

    expect(sql).toMatch(/UPDATE "GenerationAccessGrant"/);
    expect(sql).toMatch(/SET "boundWorkspaceId"/);
    expect(sql).toMatch(/WHERE[\s\S]*"boundWorkspaceId"/);
    expect(sql.indexOf('UPDATE "GenerationAccessGrant"')).toBeLessThan(
      sql.indexOf('DELETE FROM "Workspace"'),
    );
    expect(sql).not.toMatch(/\bAS\s+grant\b/i);
  });

  it('consumes the claim window, deletes old browser sessions, and writes a secret-free audit', async () => {
    const harness = repositoryHarness({ id: 'legacy_direct', replacedWorkspace: false });
    const repository = createLegacyWorkspaceClaimRepository(harness.database);
    await repository.claimByRecoveryHash(input);
    const sql = sqlFrom(harness.captured);

    expect(sql).toMatch(/UPDATE "Workspace"[\s\S]*"legacyClaimExpiresAt" = NULL/);
    expect(sql).toMatch(/DELETE FROM "WorkspaceSession"/);
    expect(sql).toMatch(/INSERT INTO "AuditEvent"/);
    expect(sql).toContain("'workspace.legacy_claimed'");
    expect(sql).toContain("jsonb_build_object('source', 'recovery_key')");
    expect(JSON.stringify(harness.captured)).not.toContain('dwk_raw_recovery_key');
    expect(harness.captured.flatMap((query) => query.values)).not.toContain('dwk_raw_recovery_key');
  });

  it('returns null for unknown, expired, wrong-origin, non-pristine, and race-lost claims', async () => {
    const harness = repositoryHarness(null);
    const repository = createLegacyWorkspaceClaimRepository(harness.database);

    await expect(repository.claimByRecoveryHash(input)).resolves.toBeNull();
  });
});
