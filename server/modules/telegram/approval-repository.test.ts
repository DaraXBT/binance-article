import { describe, expect, it, vi } from 'vitest';

import { createTelegramApprovalRepository } from './approval-repository';

function clientReturning(...results: unknown[][]) {
  const captured: Array<{ text: string; values: unknown[] }> = [];
  const client = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    captured.push({ text: strings.join('?'), values });
    return Promise.resolve(results.shift() ?? []);
  });
  return { client, captured };
}

describe('Telegram approval repository', () => {
  it('creates a challenge while atomically locking command, draft, device, and linked actor', async () => {
    const { client, captured } = clientReturning([{
      commandId: 'command_1', expiresAt: new Date('2026-07-19T00:02:00Z'),
    }]);
    const repository = createTelegramApprovalRepository({ $client: client } as never);

    await expect(repository.requestConfirmation({
      approvalId: 'approval_1', actorUserId: 'user_1', telegramUserId: '777',
      commandId: 'command_1', callbackTokenHash: 'a'.repeat(64),
      requestedExpiresAt: new Date('2026-07-19T00:02:00Z'), now: new Date(),
    })).resolves.toMatchObject({ commandId: 'command_1' });
    expect(captured[0].text).toMatch(/UPDATE "PublisherCommand"/);
    expect(captured[0].text).toMatch(/UPDATE "BinancePublicationDraft"/);
    expect(captured[0].text).toMatch(/INSERT INTO "PublishApproval"/);
    expect(captured[0].text).toMatch(/LEAST\(/);
    expect(captured[0].text).toMatch(/'awaiting_review'.*'awaiting_approval'/s);
    expect(captured[0].text).toMatch(/"providerId" = \?/);
    expect(captured[0].values).toContain('telegram');
    expect(captured[0].values).not.toContain(expect.stringMatching(/^[A-Za-z0-9_-]{43}$/));
  });

  it('approves the exact unexpired token, actor, revision, and recipe in one statement', async () => {
    const { client, captured } = clientReturning([{ commandId: 'command_1' }]);
    const repository = createTelegramApprovalRepository({ $client: client } as never);

    await expect(repository.confirm({
      actorUserId: 'user_1', telegramUserId: '777', callbackTokenHash: 'a'.repeat(64), now: new Date(),
    })).resolves.toEqual({ commandId: 'command_1' });
    expect(captured[0].text).toMatch(/"recipeHash" = command\."recipeHash"/);
    expect(captured[0].text).toMatch(/UPDATE "PublishApproval"/);
    expect(captured[0].text).toMatch(/UPDATE "PublisherCommand"/);
    expect(captured[0].text).toMatch(/UPDATE "BinancePublicationDraft"/);
    expect(captured[0].text).toMatch(/'confirmation_required'.*'approved'/s);
  });

  it('expires approval, command, and draft atomically after the deadline', async () => {
    const { client, captured } = clientReturning([{ commandId: 'command_1' }]);
    const repository = createTelegramApprovalRepository({ $client: client } as never);

    await expect(repository.expire({
      actorUserId: 'user_1', telegramUserId: '777', callbackTokenHash: 'a'.repeat(64), now: new Date(),
    })).resolves.toBe(true);
    expect(captured[0].text).toMatch(/UPDATE "PublishApproval"/);
    expect(captured[0].text).toMatch(/UPDATE "PublisherCommand"/);
    expect(captured[0].text).toMatch(/UPDATE "BinancePublicationDraft"/);
    expect(captured[0].text.match(/'expired'/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
