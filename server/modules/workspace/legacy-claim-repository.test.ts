import { describe, expect, it, vi } from 'vitest';

import { createLegacyWorkspaceClaimRepository } from './legacy-claim-repository';

describe('legacy workspace claim repository', () => {
  it('serializes by recovery hash and inserts one owner membership atomically', async () => {
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
      return [[], [{ id: 'workspace_1', accessKeyPrefix: 'dwk_aaaa' }]];
    });
    const repository = createLegacyWorkspaceClaimRepository({
      $client: { transaction },
    } as never);
    const input = {
      actorUserId: 'user_1',
      accessKeyHash: 'b'.repeat(64),
      now: new Date('2026-07-20T00:00:00.000Z'),
    };

    await expect(repository.claimByRecoveryHash(input)).resolves.toEqual({
      id: 'workspace_1', accessKeyPrefix: 'dwk_aaaa',
    });

    expect(captured[0]?.text).toMatch(/pg_advisory_xact_lock[\s\S]*hashtextextended/);
    expect(captured[1]?.text).toMatch(/"Workspace"[\s\S]*"accessKeyHash"/);
    expect(captured[1]?.text).toMatch(/"legacyClaimExpiresAt"[\s\S]*FOR UPDATE/);
    expect(captured[1]?.text).toMatch(/INSERT INTO "WorkspaceMember"/);
    expect(captured[1]?.text).toMatch(/'owner'::"WorkspaceMemberRole"/);
    expect(captured[1]?.text).toMatch(/NOT EXISTS[\s\S]*"WorkspaceMember"/);
    expect(captured[1]?.text).toMatch(/"legacyClaimedAt" IS NOT NULL/);
    expect(captured.flatMap((query) => query.values)).toContain(input.accessKeyHash);
    expect(captured.flatMap((query) => query.values)).toContain(input.actorUserId);
    expect(JSON.stringify(captured)).not.toContain('dwk_raw_recovery_key');
  });

  it('returns null when the key is unknown, outside the window, or owned by another actor', async () => {
    const transaction = vi.fn(async (
      build: (query: (strings: TemplateStringsArray, ...values: unknown[]) => unknown) => unknown[],
    ) => {
      build((strings, ...values) => ({ text: strings.join('?'), values }));
      return [[], []];
    });
    const repository = createLegacyWorkspaceClaimRepository({ $client: { transaction } } as never);
    await expect(repository.claimByRecoveryHash({
      actorUserId: 'user_1',
      accessKeyHash: 'c'.repeat(64),
      now: new Date('2026-07-20T00:00:00.000Z'),
    })).resolves.toBeNull();
  });
});
