import { describe, expect, it, vi } from 'vitest';

import { updateEnrollmentPerson } from './service';

const now = new Date('2026-08-09T00:00:00.000Z');

function repository(
  result:
    | { outcome: 'updated'; status: 'active' | 'pending' | 'suspended' | 'revoked' }
    | { outcome: 'not_found' | 'self' | 'owner' | 'last_owner' | 'invalid_transition' | 'capacity_full' },
) {
  return {
    updatePersonStatus: vi.fn(async () => result),
  };
}

describe('enrollment people administration service', () => {
  it.each([
    ['suspend', 'suspended'],
    ['revoke', 'revoked'],
  ] as const)('allows an owner %s when the repository confirms another active owner remains', async (action, status) => {
    const repo = repository({ outcome: 'updated', status });

    await expect(updateEnrollmentPerson({
      repository: repo,
      actorUserId: 'owner_1',
      userId: 'owner_2',
      action,
      now,
      auditEventId: 'audit_1',
    })).resolves.toEqual({ updated: true, status });

    expect(repo.updatePersonStatus).toHaveBeenCalledWith({
      actorUserId: 'owner_1',
      userId: 'owner_2',
      action,
      now,
      capacity: 10,
      auditEventId: 'audit_1',
    });
  });

  it('protects the last active owner for both suspension and revocation decisions', async () => {
    for (const action of ['suspend', 'revoke'] as const) {
      await expect(updateEnrollmentPerson({
        repository: repository({ outcome: 'last_owner' }),
        actorUserId: 'owner_1',
        userId: 'owner_2',
        action,
        now,
        auditEventId: `audit_${action}`,
      })).rejects.toMatchObject({
        code: 'LAST_OWNER_PROTECTED',
        status: 409,
      });
    }
  });

  it('restores either a suspended or revoked account when the repository capacity decision succeeds', async () => {
    for (const userId of ['suspended_user', 'revoked_user']) {
      const repo = repository({ outcome: 'updated', status: 'active' });

      await expect(updateEnrollmentPerson({
        repository: repo,
        actorUserId: 'owner_1',
        userId,
        action: 'restore',
        now,
        capacity: 10,
        auditEventId: `audit_${userId}`,
      })).resolves.toEqual({ updated: true, status: 'active' });

      expect(repo.updatePersonStatus).toHaveBeenCalledWith(expect.objectContaining({
        userId,
        action: 'restore',
        capacity: 10,
      }));
    }
  });

  it('reports a full-capacity restore with the beta capacity conflict', async () => {
    await expect(updateEnrollmentPerson({
      repository: repository({ outcome: 'capacity_full' }),
      actorUserId: 'owner_1',
      userId: 'suspended_user',
      action: 'restore',
      now,
      auditEventId: 'audit_1',
    })).rejects.toMatchObject({
      code: 'BETA_USER_CAP_REACHED',
      status: 409,
    });
  });

  it('rejects attempts to change the acting owner through the people lifecycle endpoint', async () => {
    await expect(updateEnrollmentPerson({
      repository: repository({ outcome: 'self' }),
      actorUserId: 'owner_1',
      userId: 'owner_1',
      action: 'suspend',
      now,
      auditEventId: 'audit_1',
    })).rejects.toMatchObject({
      code: 'SELF_STATUS_CHANGE_BLOCKED',
      status: 409,
    });
  });
});
