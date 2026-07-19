import { describe, expect, it, vi } from 'vitest';

import { createAccountWorkspaceRepository } from './account-repository';

describe('account-owned workspace repository', () => {
  it('serializes by active user and atomically creates workspace, owner membership, and audit', async () => {
    const captured: Array<{ text: string; values: unknown[] }> = [];
    const transaction = vi.fn(async (
      build: (query: (strings: TemplateStringsArray, ...values: unknown[]) => unknown) => unknown[],
      options: unknown,
    ) => {
      const queries = build((strings, ...values) => {
        const query = { text: strings.join('?'), values };
        captured.push(query);
        return query;
      });
      expect(queries).toHaveLength(2);
      expect(options).toEqual({ isolationLevel: 'ReadCommitted' });
      return [[], [{ id: 'workspace_1', created: true }]];
    });
    const repository = createAccountWorkspaceRepository({ $client: { transaction } } as never);
    const input = {
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
      auditEventId: 'audit_1',
      accessKeyHash: 'a'.repeat(64),
      accessKeyPrefix: 'acct_aaaaaaaa',
      now: new Date('2026-07-19T00:00:00.000Z'),
    };

    await expect(repository.createOrFind(input)).resolves.toEqual({
      id: 'workspace_1', created: true,
    });
    expect(captured[0]?.text).toMatch(/pg_advisory_xact_lock[\s\S]*hashtextextended/);
    expect(captured[1]?.text).toMatch(/INSERT INTO "Workspace"/);
    expect(captured[1]?.text).toMatch(/"legacyClaimExpiresAt"/);
    expect(captured[1]?.text).toMatch(/INSERT INTO "WorkspaceMember"/);
    expect(captured[1]?.text).toMatch(/'owner'::"WorkspaceMemberRole"/);
    expect(captured[1]?.text).toMatch(/INSERT INTO "AuditEvent"/);
    expect(captured[1]?.text).toContain("'workspace.created'");
    expect(captured[1]?.text).toMatch(/existing_membership[\s\S]*created_membership/);
    expect(captured.flatMap((query) => query.values)).not.toContain(undefined);
  });

  it('returns the existing workspace without creating a second one', async () => {
    const transaction = vi.fn(async (
      build: (query: (strings: TemplateStringsArray, ...values: unknown[]) => unknown) => unknown[],
    ) => {
      build((strings, ...values) => ({ text: strings.join('?'), values }));
      return [[], [{ id: 'workspace_existing', created: false }]];
    });
    const repository = createAccountWorkspaceRepository({ $client: { transaction } } as never);
    await expect(repository.createOrFind({
      actorUserId: 'user_1', workspaceId: 'workspace_new', auditEventId: 'audit_1',
      accessKeyHash: 'b'.repeat(64), accessKeyPrefix: 'acct_bbbbbbbb',
      now: new Date('2026-07-19T00:00:00.000Z'),
    })).resolves.toEqual({ id: 'workspace_existing', created: false });
  });
});
