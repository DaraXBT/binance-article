import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createDatabase: vi.fn(),
  createRepository: vi.fn(),
}));

vi.mock('@/server/db/client', () => ({ createDatabase: mocks.createDatabase }));
vi.mock('@/server/modules/telegram/update-repository', () => ({
  createTelegramUpdateRepository: mocks.createRepository,
}));

describe('Telegram Worker entrypoint', () => {
  it('does not construct a database for a request with the wrong webhook secret', async () => {
    const worker = (await import('./index')).default;
    const response = await worker.fetch(new Request('https://bot.example/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'wrong' },
      body: '{',
    }), {
      DATABASE_URL: 'postgresql://user:pass@example.neon.tech/app?sslmode=require',
      TELEGRAM_BOT_TOKEN: `123456:${'a'.repeat(32)}`,
      TELEGRAM_WEBHOOK_SECRET: 'w'.repeat(32),
      TELEGRAM_BOT_INFO: JSON.stringify({
        id: 123456, is_bot: true, first_name: 'Publisher', username: 'publisher_bot',
      }),
      APP_BASE_URL: 'https://articles.example.com',
    });

    expect(response.status).toBe(401);
    expect(mocks.createDatabase).not.toHaveBeenCalled();
    expect(mocks.createRepository).not.toHaveBeenCalled();
  });
});
