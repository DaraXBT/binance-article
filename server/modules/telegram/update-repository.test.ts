import { describe, expect, it, vi } from 'vitest';

import { createTelegramUpdateRepository } from './update-repository';

function clientReturning(...results: unknown[][]) {
  const captured: Array<{ text: string; values: unknown[] }> = [];
  const client = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    captured.push({ text: strings.join('?'), values });
    return Promise.resolve(results.shift() ?? []);
  });
  return { client, captured };
}

describe('Telegram update repository', () => {
  it('atomically claims an update and resolves only the exact Telegram provider subject', async () => {
    const { client, captured } = clientReturning([{
      claimed: true,
      payloadHash: 'a'.repeat(64),
      userId: 'user_1',
      name: 'Linked',
      status: 'active',
      role: 'user',
    }]);
    const repository = createTelegramUpdateRepository({ $client: client } as never);

    await expect(repository.claimUpdate({
      botId: 'bot_1', updateId: 4, telegramUserId: '777', payloadHash: 'a'.repeat(64), now: new Date(),
    })).resolves.toEqual({
      kind: 'claimed',
      actor: {
        id: 'user_1', name: 'Linked', status: 'active', role: 'user', telegramUserId: '777',
      },
    });
    expect(captured).toHaveLength(1);
    expect(captured[0].text).toMatch(/ON CONFLICT \("botId", "updateId"\) DO NOTHING/);
    expect(captured[0].text).toMatch(/"providerId" = \?/);
    expect(captured[0].text).toMatch(/"accountId" = \?/);
    expect(captured[0].values).toContain('telegram');
    expect(captured[0].values).toContain('777');
    expect(captured[0].text).not.toMatch(/"email"|"accessToken"|"refreshToken"|"idToken"/);
  });

  it('distinguishes an exact duplicate from a conflicting replay payload', async () => {
    const exact = createTelegramUpdateRepository({
      $client: clientReturning([{ claimed: false, payloadHash: 'a'.repeat(64) }]).client,
    } as never);
    await expect(exact.claimUpdate({
      botId: 'bot_1', updateId: 4, telegramUserId: '777', payloadHash: 'a'.repeat(64), now: new Date(),
    })).resolves.toEqual({ kind: 'duplicate' });

    const anomaly = createTelegramUpdateRepository({
      $client: clientReturning([{ claimed: false, payloadHash: 'b'.repeat(64) }]).client,
    } as never);
    await expect(anomaly.claimUpdate({
      botId: 'bot_1', updateId: 4, telegramUserId: '777', payloadHash: 'a'.repeat(64), now: new Date(),
    })).resolves.toEqual({ kind: 'replay_anomaly' });
  });

  it('completes only a currently-processing claimed update with a stable error code', async () => {
    const { client, captured } = clientReturning([{ botId: 'bot_1' }]);
    const repository = createTelegramUpdateRepository({ $client: client } as never);

    await expect(repository.completeUpdate({
      botId: 'bot_1', updateId: 4, status: 'rejected', errorCode: 'PRIVATE_CHAT_REQUIRED', now: new Date(),
    })).resolves.toBe(true);
    expect(captured[0].text).toMatch(/"status" = 'processing'/);
    expect(captured[0].values).toContain('PRIVATE_CHAT_REQUIRED');
  });
});
