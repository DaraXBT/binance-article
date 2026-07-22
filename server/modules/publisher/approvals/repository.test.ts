import { describe, expect, it, vi } from 'vitest';

import { createWebPublishApprovalRepository } from './repository';

describe('web approval repository', () => {
  it('atomically binds actor, command, revision, hash, draft, and explicit web metadata', async () => {
    const captured: Array<{ text: string; values: unknown[] }> = [];
    const client = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      captured.push({ text: strings.join('?'), values });
      return Promise.resolve([{ id: 'command_1', draftId: 'draft_1', target: 'x', state: 'approved',
        revision: 2, recipeHash: 'a'.repeat(64), expiresAt: new Date() }]);
    });
    const repository = createWebPublishApprovalRepository({ $client: client } as never);
    await repository.approve({
      approvalId: 'approval_1', actorUserId: 'user_1', commandId: 'command_1', revision: 2,
      recipeHash: 'a'.repeat(64), now: new Date(),
    });
    expect(captured[0]?.text).toMatch(/FOR UPDATE OF command/);
    expect(captured[0]?.text).toMatch(/command\."revision" = \?/);
    expect(captured[0]?.text).toMatch(/command\."recipeHash" = \?/);
    expect(captured[0]?.text).toMatch(/'web'::"PublishApprovalVia"/);
    expect(captured[0]?.text).toMatch(/UPDATE "PublisherCommand"[\s\S]*INSERT INTO "PublishApproval"/);
    expect(captured[0]?.text).toMatch(/UPDATE "PublicationDraft"/);
    expect(captured[0]?.text).toMatch(/UPDATE "BinancePublicationDraft"/);
    expect(captured[0]?.text).not.toContain('user_1');
    expect(captured[0]?.values).toContain('user_1');
  });

  it('atomically cancels a pre-click command and its open approval', async () => {
    const captured: Array<{ text: string; values: unknown[] }> = [];
    const client = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      captured.push({ text: strings.join('?'), values });
      return Promise.resolve([{ id: 'command_1', draftId: 'draft_1', target: 'x', state: 'cancelled',
        revision: 2, recipeHash: 'a'.repeat(64), expiresAt: new Date() }]);
    });
    const repository = createWebPublishApprovalRepository({ $client: client } as never);
    await repository.cancel({
      actorUserId: 'user_1', commandId: 'command_1', revision: 2,
      recipeHash: 'a'.repeat(64), now: new Date(),
    });
    expect(captured[0]?.text).toMatch(/FOR UPDATE OF command/);
    expect(captured[0]?.text).toMatch(/'cancelled'::"PublisherCommandState"/);
    expect(captured[0]?.text).toMatch(/'cancelled'::"PublicationDraftStatus"/);
    expect(captured[0]?.text).toMatch(/'cancelled'::"PublishApprovalState"/);
    expect(captured[0]?.text).not.toContain('user_1');
    expect(captured[0]?.values).toContain('user_1');
  });

  it('atomically reaps an expired pre-click command without expiring a publishing click', async () => {
    const captured: string[] = [];
    const client = vi.fn((strings: TemplateStringsArray) => {
      captured.push(strings.join('?'));
      return Promise.resolve([{ id: 'command_1', draftId: 'draft_1', target: 'x', state: 'expired',
        revision: 2, recipeHash: 'a'.repeat(64), expiresAt: new Date() }]);
    });
    const repository = createWebPublishApprovalRepository({ $client: client } as never);
    await repository.expire({ actorUserId: 'user_1', commandId: 'command_1', now: new Date() });
    expect(captured[0]).toMatch(/command\."expiresAt" <= \?/);
    expect(captured[0]).toMatch(/'expired'::"PublisherCommandState"/);
    expect(captured[0]).toMatch(/'expired'::"PublicationDraftStatus"/);
    expect(captured[0]).toMatch(/'expired'::"PublishApprovalState"/);
    expect(captured[0]).not.toMatch(/'publishing'::"PublisherCommandState"/);
  });
});
