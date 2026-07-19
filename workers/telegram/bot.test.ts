import { describe, expect, it, vi } from 'vitest';

import { createTelegramBot, dispatchTelegramCommand } from './bot';

const actor = {
  id: 'user_1',
  name: 'Linked User',
  status: 'active' as const,
  role: 'user' as const,
  telegramUserId: '777',
};

function metadataRepository() {
  return {
    listArticles: vi.fn(async () => [{
      id: 'article_1', title: 'Safe title', status: 'draft', updatedAt: new Date('2026-07-19T00:00:00Z'),
    }]),
    listStatuses: vi.fn(async () => [{
      id: 'job_1', kind: 'outline', status: 'running', progress: 40, errorCode: null,
      updatedAt: new Date('2026-07-19T00:00:00Z'),
    }]),
    listDevices: vi.fn(async () => [{
      id: 'device_1', name: 'My Mac', status: 'active', protocolVersion: 1,
      pairedAt: new Date('2026-07-19T00:00:00Z'), lastSeenAt: new Date('2026-07-19T00:01:00Z'),
    }]),
    getAdminOverview: vi.fn(async () => ({ activeUsers: 2, pendingInvitations: 1, activeDevices: 1 })),
  };
}

describe('metadata-only Telegram commands', () => {
  it.each(['/start', '/help'])('returns safe help for %s', async (text) => {
    const reply = await dispatchTelegramCommand({
      text, actor, repository: metadataRepository(), appBaseUrl: 'https://articles.example.com',
    });
    expect(reply).toContain('Binance');
    expect(reply).not.toMatch(/cookie|token hash|chrome profile/i);
  });

  it('lists article identity and status but never content or storage data', async () => {
    const reply = await dispatchTelegramCommand({
      text: '/articles', actor, repository: metadataRepository(), appBaseUrl: 'https://articles.example.com',
    });
    expect(reply).toContain('Safe title');
    expect(reply).toContain('https://articles.example.com/articles/article_1');
    expect(reply).not.toMatch(/markdown|r2|content=/i);
  });

  it('returns safe status, device, new-article, and owner-only admin responses', async () => {
    const repository = metadataRepository();
    await expect(dispatchTelegramCommand({
      text: '/new', actor, repository, appBaseUrl: 'https://articles.example.com',
    })).resolves.toContain('https://articles.example.com/new');
    await expect(dispatchTelegramCommand({
      text: '/status', actor, repository, appBaseUrl: 'https://articles.example.com',
    })).resolves.toContain('40%');
    await expect(dispatchTelegramCommand({
      text: '/devices', actor, repository, appBaseUrl: 'https://articles.example.com',
    })).resolves.toContain('My Mac');
    await expect(dispatchTelegramCommand({
      text: '/admin', actor, repository, appBaseUrl: 'https://articles.example.com',
    })).resolves.toBe('Owner access is required.');
    expect(repository.getAdminOverview).not.toHaveBeenCalled();
  });

  it('constructs a grammY bot without network discovery when bot info is supplied', () => {
    const bot = createTelegramBot({
      token: `123456:${'a'.repeat(32)}`,
      botInfo: { id: 123456, is_bot: true, first_name: 'Publisher', username: 'publisher_bot' },
      actor,
      repository: metadataRepository(),
      appBaseUrl: 'https://articles.example.com',
    });
    expect(bot.botInfo.username).toBe('publisher_bot');
  });
});
