import { describe, expect, it, vi } from 'vitest';

import { createGenerationAccessGrantRepository } from './generate-access-repository';

function grantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'grant_1',
    status: 'active',
    boundWorkspaceId: null,
    boundSessionId: null,
    envCodeHash: 'a'.repeat(64),
    ...overrides,
  };
}

describe('generation access grant repository', () => {
  it('finds grants by id without selecting or returning their code hash', async () => {
    const captured: Array<{ text: string; values: unknown[] }> = [];
    const client = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      captured.push({ text: strings.join('?'), values });
      return [grantRow()];
    });
    const repository = createGenerationAccessGrantRepository({ $client: client } as never);

    await expect(repository.findById('grant_1')).resolves.toEqual(grantRow());
    expect(captured[0]?.text).toMatch(/FROM "GenerationAccessGrant"/);
    expect(captured[0]?.text).toMatch(/WHERE "id" =/);
    expect(captured[0]?.text).not.toContain('"codeHash"');
    expect(captured[0]?.values).toEqual(['grant_1']);
  });

  it('finds a grant by its SHA-256 code hash through a parameterized query', async () => {
    const captured: Array<{ text: string; values: unknown[] }> = [];
    const client = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      captured.push({ text: strings.join('?'), values });
      return [grantRow()];
    });
    const repository = createGenerationAccessGrantRepository({ $client: client } as never);
    const codeHash = 'b'.repeat(64);

    await expect(repository.findByCodeHash(codeHash)).resolves.toEqual(grantRow());
    expect(captured[0]?.text).toMatch(/WHERE "codeHash" =/);
    expect(captured[0]?.values).toEqual([codeHash]);
  });

  it('atomically consumes only an active unbound grant for the current rotation', async () => {
    const captured: Array<{ text: string; values: unknown[] }> = [];
    const client = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      captured.push({ text: strings.join('?'), values });
      return [{ id: 'grant_1' }];
    });
    const repository = createGenerationAccessGrantRepository({ $client: client } as never);
    const now = new Date('2026-07-19T00:00:00.000Z');

    await expect(repository.consumeUnbound({
      grantId: 'grant_1',
      workspaceId: 'workspace_1',
      sessionId: 'session_1',
      envCodeHash: 'c'.repeat(64),
      now,
    })).resolves.toBe(true);

    expect(captured[0]?.text).toMatch(/UPDATE "GenerationAccessGrant"/);
    expect(captured[0]?.text).toMatch(/"status" = 'consumed'/);
    expect(captured[0]?.text).toMatch(/"boundWorkspaceId" IS NULL/);
    expect(captured[0]?.text).toMatch(/"boundSessionId" IS NULL/);
    expect(captured[0]?.text).toMatch(/"status" = 'active'/);
    expect(captured[0]?.text).toMatch(/"envCodeHash" =/);
    expect(captured[0]?.text).toMatch(/"updatedAt" =/);
    expect(captured[0]?.values).toEqual(expect.arrayContaining([
      'grant_1', 'workspace_1', 'session_1', 'c'.repeat(64), now,
    ]));
  });

  it('reports a lost consume race without overwriting the winner', async () => {
    const client = vi.fn(async () => []);
    const repository = createGenerationAccessGrantRepository({ $client: client } as never);

    await expect(repository.consumeUnbound({
      grantId: 'grant_1',
      workspaceId: 'workspace_1',
      sessionId: 'session_1',
      envCodeHash: 'c'.repeat(64),
      now: new Date('2026-07-19T00:00:00.000Z'),
    })).resolves.toBe(false);
  });
});
