import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleTelegramWebhook } from './update-service';

const privateUpdate = {
  update_id: 123,
  message: {
    message_id: 5,
    from: { id: 777, is_bot: false, first_name: 'Linked' },
    chat: { id: 777, type: 'private' },
    text: '/help',
  },
};

function webhookRequest(body: string, secret = 'w'.repeat(32), headers?: HeadersInit) {
  return new Request('https://telegram-worker.example/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': secret,
      ...headers,
    },
    body,
  });
}

describe('Telegram webhook admission', () => {
  const repository = {
    claimUpdate: vi.fn(),
    completeUpdate: vi.fn(),
  };
  const repositoryFactory = vi.fn(() => repository);
  const executeUpdate = vi.fn(async () => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    repository.claimUpdate.mockResolvedValue({
      kind: 'claimed',
      actor: {
        id: 'user_1',
        name: 'Linked User',
        status: 'active',
        role: 'user',
        telegramUserId: '777',
      },
    });
    repository.completeUpdate.mockResolvedValue(true);
  });

  it('rejects a bad secret before parsing malformed JSON or creating a repository', async () => {
    const response = await handleTelegramWebhook({
      request: webhookRequest('{', 'wrong-secret'),
      expectedWebhookSecret: 'w'.repeat(32),
      botId: 'bot_1',
      repositoryFactory,
      executeUpdate,
    });

    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(repositoryFactory).not.toHaveBeenCalled();
    expect(executeUpdate).not.toHaveBeenCalled();
  });

  it('claims a bounded private update, resolves its linked actor, and completes it once', async () => {
    const response = await handleTelegramWebhook({
      request: webhookRequest(JSON.stringify(privateUpdate)),
      expectedWebhookSecret: 'w'.repeat(32),
      botId: 'bot_1',
      repositoryFactory,
      executeUpdate,
      now: new Date('2026-07-19T00:00:00.000Z'),
    });

    expect(response.status).toBe(200);
    expect(repository.claimUpdate).toHaveBeenCalledOnce();
    expect(repository.claimUpdate.mock.calls[0][0]).toMatchObject({
      botId: 'bot_1',
      updateId: 123,
      telegramUserId: '777',
      payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(repository.claimUpdate.mock.calls[0][0])).not.toContain('/help');
    expect(executeUpdate).toHaveBeenCalledWith({
      update: privateUpdate,
      actor: expect.objectContaining({ id: 'user_1', telegramUserId: '777' }),
    });
    expect(repository.completeUpdate).toHaveBeenCalledWith({
      botId: 'bot_1',
      updateId: 123,
      status: 'processed',
      errorCode: null,
      now: new Date('2026-07-19T00:00:00.000Z'),
    });
  });

  it.each([
    ['duplicate', { kind: 'duplicate' }],
    ['replay anomaly', { kind: 'replay_anomaly' }],
  ])('acknowledges a %s without executing it again', async (_label, claim) => {
    repository.claimUpdate.mockResolvedValueOnce(claim);

    const response = await handleTelegramWebhook({
      request: webhookRequest(JSON.stringify(privateUpdate)),
      expectedWebhookSecret: 'w'.repeat(32),
      botId: 'bot_1',
      repositoryFactory,
      executeUpdate,
    });

    expect(response.status).toBe(200);
    expect(executeUpdate).not.toHaveBeenCalled();
    expect(repository.completeUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['group chat', { update: { ...privateUpdate, message: { ...privateUpdate.message, chat: { id: -1, type: 'group' } } } }],
    ['unlinked actor', { actor: null }],
    ['suspended actor', { actor: { id: 'user_1', name: 'User', role: 'user', status: 'suspended', telegramUserId: '777' } }],
  ])('rejects a claimed %s without running a command', async (_label, override) => {
    const update = 'update' in override ? override.update : privateUpdate;
    if ('actor' in override) {
      repository.claimUpdate.mockResolvedValueOnce({ kind: 'claimed', actor: override.actor });
    }

    const response = await handleTelegramWebhook({
      request: webhookRequest(JSON.stringify(update)),
      expectedWebhookSecret: 'w'.repeat(32),
      botId: 'bot_1',
      repositoryFactory,
      executeUpdate,
    });

    expect(response.status).toBe(200);
    expect(executeUpdate).not.toHaveBeenCalled();
    expect(repository.completeUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'rejected',
      errorCode: expect.any(String),
    }));
  });

  it('rejects oversized bodies without reading or touching Neon', async () => {
    const response = await handleTelegramWebhook({
      request: webhookRequest('{}', 'w'.repeat(32), { 'content-length': '200000' }),
      expectedWebhookSecret: 'w'.repeat(32),
      botId: 'bot_1',
      repositoryFactory,
      executeUpdate,
    });

    expect(response.status).toBe(413);
    expect(repositoryFactory).not.toHaveBeenCalled();
  });
});
