import { describe, expect, it } from 'vitest';

import {
  TELEGRAM_APPROVAL_LIFETIME_MS,
  advancePublishApproval,
  authorizeTelegramWebhook,
} from './telegram-authorization';

const now = new Date('2026-07-19T00:00:00.000Z');

describe('Telegram webhook authorization', () => {
  it('accepts a new private-chat update from the linked active user', () => {
    expect(authorizeTelegramWebhook({
      expectedWebhookSecret: 'expected-secret',
      presentedWebhookSecret: 'expected-secret',
      chatType: 'private',
      telegramUserId: '12345',
      linkedTelegramUserId: '12345',
      userStatus: 'active',
      updateAlreadyProcessed: false,
    })).toEqual({ ok: true });
  });

  it.each([
    ['invalid_secret', { presentedWebhookSecret: 'wrong' }],
    ['private_chat_required', { chatType: 'group' as const }],
    ['identity_mismatch', { telegramUserId: '999' }],
    ['user_suspended', { userStatus: 'suspended' as const }],
    ['replayed_update', { updateAlreadyProcessed: true }],
  ])('rejects unauthorized input with %s', (reason, override) => {
    const result = authorizeTelegramWebhook({
      expectedWebhookSecret: 'expected-secret',
      presentedWebhookSecret: 'expected-secret',
      chatType: 'private',
      telegramUserId: '12345',
      linkedTelegramUserId: '12345',
      userStatus: 'active',
      updateAlreadyProcessed: false,
      ...override,
    });
    expect(result).toEqual({ ok: false, reason });
  });
});

describe('Telegram publish double confirmation', () => {
  const approval = {
    id: 'approval_123',
    state: 'pending' as const,
    userId: 'user_123',
    telegramUserId: '12345',
    commandId: 'command_123',
    draftId: 'draft_123',
    revision: 7,
    recipeHash: 'a'.repeat(64),
    expiresAt: new Date(now.getTime() + TELEGRAM_APPROVAL_LIFETIME_MS),
  };

  it('requires Publish then Confirm Publish by the same user for the exact revision', () => {
    const confirmation = advancePublishApproval(approval, {
      type: 'request_confirmation',
      telegramUserId: '12345',
      commandId: 'command_123',
      draftId: 'draft_123',
      revision: 7,
      recipeHash: 'a'.repeat(64),
      chatType: 'private',
    }, now);
    expect(confirmation.state).toBe('confirmation_required');

    const approved = advancePublishApproval(confirmation, {
      type: 'confirm_publish',
      telegramUserId: '12345',
      commandId: 'command_123',
      draftId: 'draft_123',
      revision: 7,
      recipeHash: 'a'.repeat(64),
      chatType: 'private',
    }, now);
    expect(approved.state).toBe('approved');
  });

  it.each([
    ['wrong identity', { telegramUserId: '999' }],
    ['stale draft', { draftId: 'draft_old' }],
    ['stale revision', { revision: 6 }],
    ['group callback', { chatType: 'group' as const }],
  ])('rejects confirmation from the %s', (_label, override) => {
    const confirmation = { ...approval, state: 'confirmation_required' as const };
    expect(() => advancePublishApproval(confirmation, {
      type: 'confirm_publish',
      telegramUserId: '12345',
      commandId: 'command_123',
      draftId: 'draft_123',
      revision: 7,
      recipeHash: 'a'.repeat(64),
      chatType: 'private',
      ...override,
    }, now)).toThrow();
  });

  it('rejects expired and replayed confirmations', () => {
    const confirmation = { ...approval, state: 'confirmation_required' as const };
    expect(() => advancePublishApproval(
      { ...confirmation, expiresAt: now },
      {
        type: 'confirm_publish', telegramUserId: '12345', commandId: 'command_123',
        draftId: 'draft_123', revision: 7, recipeHash: 'a'.repeat(64), chatType: 'private',
      },
      now,
    )).toThrow(/expired/i);
    expect(() => advancePublishApproval(
      { ...approval, state: 'approved' as const },
      {
        type: 'confirm_publish', telegramUserId: '12345', commandId: 'command_123',
        draftId: 'draft_123', revision: 7, recipeHash: 'a'.repeat(64), chatType: 'private',
      },
      now,
    )).toThrow(/already processed/i);
  });

  it.each([
    ['command', { commandId: 'command_old' }],
    ['recipe hash', { recipeHash: 'b'.repeat(64) }],
  ])('binds confirmation to the exact %s', (_label, override) => {
    expect(() => advancePublishApproval({
      ...approval,
      state: 'confirmation_required' as const,
    }, {
      type: 'confirm_publish',
      telegramUserId: '12345',
      commandId: 'command_123',
      draftId: 'draft_123',
      revision: 7,
      recipeHash: 'a'.repeat(64),
      chatType: 'private',
      ...override,
    }, now)).toThrow();
  });

  it('transitions an elapsed approval to terminal expired exactly once', () => {
    const expired = advancePublishApproval({ ...approval, expiresAt: now }, {
      type: 'expire',
      commandId: 'command_123',
      draftId: 'draft_123',
      revision: 7,
      recipeHash: 'a'.repeat(64),
    }, now);

    expect(expired.state).toBe('expired');
    expect(() => advancePublishApproval(expired, {
      type: 'expire',
      commandId: 'command_123',
      draftId: 'draft_123',
      revision: 7,
      recipeHash: 'a'.repeat(64),
    }, now)).toThrow(/already processed/i);
  });
});
