import { describe, expect, it, vi } from 'vitest';

import { createLegacyWorkspaceClaimRepository } from './legacy-claim-repository';

describe('legacy workspace claim repository', () => {
  it('serializes by recovery hash and inserts one owner membership atomically', async () => {
    const captured: Array<{ text: string; values: unknown[] }> = [];
    const client = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      captured.push({ text: strings.join('?'), values });
      return [{ id: 'workspace_1' }];
    });
    const repository = createLegacyWorkspaceClaimRepository({
      $client: client,
    } as never);
    const input = {
      actorUserId: 'user_1',
      accessKeyHash: 'b'.repeat(64),
      auditEventId: 'audit_1',
      now: new Date('2026-07-20T00:00:00.000Z'),
    };

    await expect(repository.claimByRecoveryHash(input)).resolves.toEqual({ id: 'workspace_1' });

    expect(client).toHaveBeenCalledTimes(1);
    expect(captured[0]?.text).toMatch(/"Workspace"[\s\S]*"accessKeyHash"/);
    expect(captured[0]?.text).toMatch(/"legacyClaimExpiresAt"[\s\S]*FOR UPDATE/);
    expect(captured[0]?.text).toMatch(/INSERT INTO "WorkspaceMember"/);
    expect(captured[0]?.text).toMatch(/'owner'::"WorkspaceMemberRole"/);
    expect(captured[0]?.text).toMatch(/NOT EXISTS[\s\S]*"WorkspaceMember"/);
    expect(captured[0]?.text).toMatch(
      /actor_membership[\s\S]*actor_membership\."userId"/,
    );
    expect(captured[0]?.text).toMatch(/UPDATE "Workspace"[\s\S]*"legacyClaimExpiresAt" = NULL/);
    expect(captured[0]?.text).toMatch(/DELETE FROM "WorkspaceSession"/);
    expect(captured[0]?.text).toMatch(/INSERT INTO "AuditEvent"/);
    expect(captured[0]?.text).toContain("'workspace.legacy_claimed'");
    expect(captured[0]?.text).toContain("jsonb_build_object('source', 'recovery_key')");
    expect(captured.flatMap((query) => query.values)).toContain(input.accessKeyHash);
    expect(captured.flatMap((query) => query.values)).toContain(input.actorUserId);
    expect(captured.flatMap((query) => query.values)).toContain(input.auditEventId);
    expect(JSON.stringify(captured)).not.toContain('dwk_raw_recovery_key');
    expect(JSON.stringify(captured)).not.toContain('accessKeyPrefix');
  });

  it('returns null when the key is unknown, outside the window, or owned by another actor', async () => {
    const client = vi.fn(async () => []);
    const repository = createLegacyWorkspaceClaimRepository({ $client: client } as never);
    await expect(repository.claimByRecoveryHash({
      actorUserId: 'user_1',
      accessKeyHash: 'c'.repeat(64),
      auditEventId: 'audit_1',
      now: new Date('2026-07-20T00:00:00.000Z'),
    })).resolves.toBeNull();
  });
});
