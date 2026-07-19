import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  headers: vi.fn(async () => new Headers({ cookie: 'better-auth.session_token=opaque' })),
  requireActiveUser: vi.fn(async () => ({ id: 'user_1', status: 'active' })),
  redirect: vi.fn((location: string) => {
    throw new Error(`REDIRECT:${location}`);
  }),
}));

vi.mock('next/headers', () => ({ headers: mocks.headers }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/server/auth/authorization', () => ({ requireActiveUser: mocks.requireActiveUser }));
vi.mock('@/components/auth/telegram-connection-card', () => ({
  TelegramConnectionCard: () => null,
}));

describe('/settings/connections', () => {
  it('requires a current active database-backed session before rendering', async () => {
    const { default: ConnectionsPage } = await import('./page');

    await ConnectionsPage();

    expect(mocks.requireActiveUser).toHaveBeenCalledOnce();
    const request = mocks.requireActiveUser.mock.calls[0][0] as Request;
    expect(request.headers.get('cookie')).toBe('better-auth.session_token=opaque');
  });

  it('redirects unauthenticated visitors to login with a safe local callback', async () => {
    mocks.requireActiveUser.mockRejectedValueOnce(new Error('no session'));
    const { default: ConnectionsPage } = await import('./page');

    await expect(ConnectionsPage()).rejects.toThrow(
      'REDIRECT:/login?callbackURL=%2Fsettings%2Fconnections',
    );
  });
});
