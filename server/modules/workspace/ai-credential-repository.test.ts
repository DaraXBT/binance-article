import { describe, expect, it, vi } from 'vitest';

import { createWorkspaceAiCredentialRepository } from './ai-credential-repository';

const now = new Date('2026-07-26T08:00:00.000Z');
const earlier = new Date('2026-07-26T07:00:00.000Z');

function credentialRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'credential_1',
    workspaceId: 'workspace_1',
    provider: 'gemini',
    ciphertext: 'A'.repeat(48),
    nonce: 'B'.repeat(16),
    encryptionKeyId: 'key-2026-07',
    enabled: false,
    validatedAt: earlier,
    createdAt: earlier,
    updatedAt: earlier,
    ...overrides,
  };
}

interface CapturedQuery {
  text: string;
  values: unknown[];
}

function transactionHarness(results: unknown[]) {
  const captured: CapturedQuery[] = [];
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
    return results;
  });
  return {
    database: { $client: { transaction } } as never,
    captured,
    transaction,
  };
}

function directQueryHarness(rows: unknown[]) {
  const captured: CapturedQuery[] = [];
  const client = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    captured.push({ text: strings.join('?'), values });
    return rows;
  });
  return { database: { $client: client } as never, captured, client };
}

describe('workspace AI credential repository', () => {
  it('reads owner settings only through an active exact workspace owner membership', async () => {
    const harness = directQueryHarness([credentialRow()]);
    const repository = createWorkspaceAiCredentialRepository(harness.database);

    await expect(repository.findOwned({
      actorUserId: 'user_1', workspaceId: 'workspace_1', provider: 'gemini',
    })).resolves.toMatchObject({ id: 'credential_1', provider: 'gemini' });

    const query = harness.captured[0];
    expect(query?.text).toContain(`actor."status" = 'active'::"UserStatus"`);
    expect(query?.text).toContain(`member."role" = 'owner'::"WorkspaceMemberRole"`);
    expect(query?.text).toContain('credential."workspaceId" = ?');
    expect(query?.values).toEqual(expect.arrayContaining([
      'user_1', 'workspace_1', 'gemini',
    ]));
    expect(query?.text).not.toMatch(/actor\."role"|"UserRole"/);
  });

  it('atomically creates or rotates encrypted data after rechecking the active owner and writes a safe audit', async () => {
    const harness = transactionHarness([[], [credentialRow({ operation: 'created' })]]);
    const repository = createWorkspaceAiCredentialRepository(harness.database);

    await expect(repository.saveOwned({
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
      provider: 'gemini',
      credentialId: 'credential_1',
      ciphertext: 'A'.repeat(48),
      nonce: 'B'.repeat(16),
      encryptionKeyId: 'key-2026-07',
      validatedAt: earlier,
      auditEventId: 'audit_1',
      now,
    })).resolves.toMatchObject({
      operation: 'created',
      record: { id: 'credential_1', enabled: false },
    });

    expect(harness.captured[0]?.text).toMatch(/pg_advisory_xact_lock[\s\S]*hashtextextended/);
    const mutation = harness.captured[1]?.text ?? '';
    expect(mutation).toContain(`actor."status" = 'active'::"UserStatus"`);
    expect(mutation).toContain(`member."role" = 'owner'::"WorkspaceMemberRole"`);
    expect(mutation).toContain('ON CONFLICT ("workspaceId", "provider") DO UPDATE');
    expect(mutation).toContain("'ai_credential.rotated'");
    expect(mutation).toContain("'ai_credential.created'");
    expect(mutation).toContain(
      "jsonb_build_object('provider', 'gemini', 'source', 'settings')",
    );
    const conflictUpdate = mutation.split('DO UPDATE SET')[1]?.split('RETURNING')[0] ?? '';
    expect(conflictUpdate).not.toContain('"enabled"');
    expect(mutation.match(/jsonb_build_object\([\s\S]*?\)/)?.[0]).not.toMatch(
      /ciphertext|nonce|encryptionKeyId|apiKey/i,
    );
    expect(harness.captured.flatMap((query) => query.values)).not.toContain(undefined);
  });

  it('changes the active source with optimistic rotation protection and an atomic from/to audit', async () => {
    const harness = transactionHarness([[], [credentialRow({
      enabled: true,
      updatedAt: now,
      changed: true,
    })]]);
    const repository = createWorkspaceAiCredentialRepository(harness.database);

    await expect(repository.changeSourceOwned({
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
      provider: 'gemini',
      credentialId: 'credential_1',
      expectedUpdatedAt: earlier,
      source: 'workspace',
      auditEventId: 'audit_2',
      now,
    })).resolves.toMatchObject({ changed: true, record: { enabled: true } });

    const mutation = harness.captured[1]?.text ?? '';
    expect(mutation).toContain('credential."updatedAt" = ?');
    expect(mutation).toContain("'ai_credential.source_changed'");
    expect(mutation).toMatch(/'from'[\s\S]*'workspace'[\s\S]*'platform'/);
    expect(mutation).toMatch(/'to'[\s\S]*'workspace'[\s\S]*'platform'/);
    expect(mutation).toContain(`member."role" = 'owner'::"WorkspaceMemberRole"`);
    expect(mutation).toContain(`actor."status" = 'active'::"UserStatus"`);
  });

  it('records a successful test only if the owner-tested credential revision is still current', async () => {
    const harness = directQueryHarness([credentialRow({
      validatedAt: now,
      updatedAt: now,
    })]);
    const repository = createWorkspaceAiCredentialRepository(harness.database);

    await expect(repository.recordValidationOwned({
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
      provider: 'gemini',
      credentialId: 'credential_1',
      expectedUpdatedAt: earlier,
      validatedAt: now,
      now,
    })).resolves.toMatchObject({ validatedAt: now, updatedAt: now });

    const query = harness.captured[0]?.text ?? '';
    expect(query).toContain('credential."updatedAt" = ?');
    expect(query).toContain(`member."role" = 'owner'::"WorkspaceMemberRole"`);
    expect(query).toContain(`actor."status" = 'active'::"UserStatus"`);
  });

  it('deletes only through the active owner condition and audits without secret metadata', async () => {
    const harness = transactionHarness([[], [{ id: 'credential_1' }]]);
    const repository = createWorkspaceAiCredentialRepository(harness.database);

    await expect(repository.deleteOwned({
      actorUserId: 'user_1',
      workspaceId: 'workspace_1',
      provider: 'gemini',
      auditEventId: 'audit_3',
      now,
    })).resolves.toEqual({ deleted: true });

    const mutation = harness.captured[1]?.text ?? '';
    expect(mutation).toContain('DELETE FROM "WorkspaceAiCredential"');
    expect(mutation).toContain(`member."role" = 'owner'::"WorkspaceMemberRole"`);
    expect(mutation).toContain(`actor."status" = 'active'::"UserStatus"`);
    expect(mutation).toContain("'ai_credential.deleted'");
    expect(mutation).toContain(
      "jsonb_build_object('provider', 'gemini', 'source', 'settings')",
    );
  });

  it('fails closed when a mutation cannot prove the owner condition', async () => {
    const harness = transactionHarness([[], []]);
    const repository = createWorkspaceAiCredentialRepository(harness.database);

    await expect(repository.saveOwned({
      actorUserId: 'cross_workspace_user',
      workspaceId: 'workspace_1',
      provider: 'gemini',
      credentialId: 'credential_1',
      ciphertext: 'A'.repeat(48),
      nonce: 'B'.repeat(16),
      encryptionKeyId: 'key-2026-07',
      validatedAt: earlier,
      auditEventId: 'audit_4',
      now,
    })).resolves.toBeNull();
  });

  it('fails closed instead of treating a malformed stored row as platform fallback', async () => {
    const harness = directQueryHarness([credentialRow({ enabled: 'yes' })]);
    const repository = createWorkspaceAiCredentialRepository(harness.database);

    await expect(repository.findByWorkspaceProvider({
      workspaceId: 'workspace_1', provider: 'gemini',
    })).rejects.toThrow('Workspace AI credential row is invalid.');
  });
});
