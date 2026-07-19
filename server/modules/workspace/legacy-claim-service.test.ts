import { describe, expect, it, vi } from 'vitest';

import { claimLegacyWorkspace } from './legacy-claim-service';

const now = new Date('2026-07-20T00:00:00.000Z');
const recoveryKey = `dwk_${'a'.repeat(36)}`;

function repository(result: { id: string; accessKeyPrefix: string } | null = {
  id: 'workspace_1',
  accessKeyPrefix: 'dwk_aaaaaaaa',
}) {
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
    })).resolves.toEqual({ id: 'workspace_1', accessKeyPrefix: 'dwk_aaaaaaaa' });

    expect(repo.claimByRecoveryHash).toHaveBeenCalledWith({
      actorUserId: 'user_1',
      accessKeyHash: 'c2746e09fb8afc014ee50930dfa8ea5d2931d1704edc2b66d90cb67b7ba24656',
      now,
    });
    expect(JSON.stringify(repo.claimByRecoveryHash.mock.calls)).not.toContain(recoveryKey);
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
        code: 'LEGACY_WORKSPACE_CLAIM_INVALID',
        message: 'The recovery key is invalid or unavailable.',
        status: 400,
      });
    }
  });

  it('does not distinguish an expired claim from an unknown or already-owned workspace', async () => {
    await expect(claimLegacyWorkspace({
      repository: repository(null),
      actorUserId: 'user_1',
      recoveryKey,
      now,
    })).rejects.toMatchObject({
      code: 'LEGACY_WORKSPACE_CLAIM_INVALID',
      message: 'The recovery key is invalid or unavailable.',
      status: 400,
    });
  });
});
