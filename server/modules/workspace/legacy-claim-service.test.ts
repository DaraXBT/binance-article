import { describe, expect, it, vi } from 'vitest';

import { claimLegacyWorkspace } from './legacy-claim-service';

const now = new Date('2026-07-20T00:00:00.000Z');
const recoveryKey = `dwk_${'a'.repeat(36)}`;

function repository(
  result: { id: string; replacedWorkspace: boolean } | null = {
    id: 'workspace_1',
    replacedWorkspace: false,
  },
) {
  return { claimByRecoveryHash: vi.fn(async () => result) };
}

describe('legacy workspace account claim', () => {
  it('hashes the recovery key before the atomic repository boundary', async () => {
    const repo = repository();
    await expect(claimLegacyWorkspace({
      repository: repo,
      actorUserId: 'user_1',
      recoveryKey,
      now,
    })).resolves.toEqual({ id: 'workspace_1', replacedWorkspace: false });

    expect(repo.claimByRecoveryHash).toHaveBeenCalledWith({
      actorUserId: 'user_1',
      accessKeyHash: 'c2746e09fb8afc014ee50930dfa8ea5d2931d1704edc2b66d90cb67b7ba24656',
      auditEventId: expect.any(String),
      now,
    });
    expect(JSON.stringify(repo.claimByRecoveryHash.mock.calls)).not.toContain(recoveryKey);
  });

  it('preserves the repository replacement result for the API contract', async () => {
    await expect(claimLegacyWorkspace({
      repository: repository({ id: 'workspace_legacy', replacedWorkspace: true }),
      actorUserId: 'user_1',
      recoveryKey,
      now,
    })).resolves.toEqual({
      id: 'workspace_legacy',
      replacedWorkspace: true,
    });
  });

  it('returns one generic error for malformed, unknown, or already-claimed keys', async () => {
    const unavailable = repository(null);
    for (const key of ['bad-key', recoveryKey]) {
      const repo = key === recoveryKey ? unavailable : repository();
      await expect(claimLegacyWorkspace({
        repository: repo,
        actorUserId: 'user_1',
        recoveryKey: key,
        now,
      })).rejects.toMatchObject({
        code: 'LEGACY_WORKSPACE_UNAVAILABLE',
        message: 'The recovery key is invalid or no longer available.',
        status: 404,
      });
    }
  });

  it('does not distinguish expired, wrong-origin, non-pristine, or race-lost claims', async () => {
    for (const _reason of ['expired', 'wrong-origin', 'non-pristine', 'race-lost']) {
      await expect(claimLegacyWorkspace({
        repository: repository(null),
        actorUserId: 'user_1',
        recoveryKey,
        now,
      })).rejects.toMatchObject({
        code: 'LEGACY_WORKSPACE_UNAVAILABLE',
        message: 'The recovery key is invalid or no longer available.',
        status: 404,
      });
    }
  });
});
