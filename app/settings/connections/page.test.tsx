import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireActivePageUser: vi.fn(async () => ({ id: 'user_1', status: 'active' })),
}));

vi.mock('@/server/auth/page-authorization', () => ({
  requireActivePageUser: mocks.requireActivePageUser,
}));
vi.mock('@/components/auth/telegram-connection-card', () => ({
  TelegramConnectionCard: () => null,
}));

describe('/settings/connections', () => {
  it('is wrapped by the authenticated settings layout', async () => {
    const { default: SettingsLayout } = await import('../layout');
    const child = { type: 'child' } as never;
    await expect(SettingsLayout({ children: child })).resolves.toBe(child);
    expect(mocks.requireActivePageUser).toHaveBeenCalledWith('/settings/connections');
  });
});
