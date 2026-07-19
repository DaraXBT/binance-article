import { describe, expect, it, vi } from 'vitest';

import { createDrizzleInvitationRepository } from './invitation-repository';

function clientReturning(rows: unknown[]) {
  const captured: Array<{ text: string; values: unknown[] }> = [];
  const client = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    captured.push({ text: strings.join('?'), values });
    return Promise.resolve(rows);
  });
  return { client, captured };
}

describe('invitation enrollment repository', () => {
  it('atomically promotes the sole user when attaching a bootstrap invitation', async () => {
    const { client, captured } = clientReturning([{ id: 'bootstrap_invite-id' }]);
    const repository = createDrizzleInvitationRepository({ $client: client } as never);
    const now = new Date('2026-07-20T00:00:00.000Z');

    await expect(repository.attachUser({
      invitationId: 'bootstrap_invite-id',
      userId: 'user_1',
      now,
    })).resolves.toBeUndefined();

    expect(captured).toHaveLength(1);
    expect(captured[0].text).toMatch(/FOR UPDATE/);
    expect(captured[0].text).toMatch(/bootstrap\\_%/);
    expect(captured[0].text).toMatch(/UPDATE "user"[\s\S]*"role" = 'owner'/);
    expect(captured[0].text).toMatch(/NOT EXISTS[\s\S]*other_user/);
    expect(captured[0].text).toMatch(/UPDATE "Invitation"[\s\S]*"acceptedByUserId"/);
    expect(captured[0].values).toEqual(expect.arrayContaining([
      'bootstrap_invite-id',
      'user_1',
      now,
    ]));
  });

  it('fails closed when no invitation can be attached', async () => {
    const repository = createDrizzleInvitationRepository({
      $client: clientReturning([]).client,
    } as never);

    await expect(repository.attachUser({
      invitationId: 'missing',
      userId: 'user_1',
      now: new Date(),
    })).rejects.toThrow(/could not be linked/i);
  });
});
