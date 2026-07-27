import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
  requireActivePageUser: vi.fn(async () => ({ id: 'user_1', status: 'active' })),
}));

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}));

vi.mock('@/server/auth/page-authorization', () => ({
  requireActivePageUser: mocks.requireActivePageUser,
}));

describe('/settings/connections', () => {
  it('uses the workspace dialog URL as its authenticated callback', async () => {
    const { default: ConnectionsLayout } = await import('./layout');
    const child = { type: 'child' } as never;

    await expect(ConnectionsLayout({ children: child })).resolves.toBe(child);
    expect(mocks.requireActivePageUser).toHaveBeenCalledWith(
      '/workspace?settings=connections',
    );
  });

  it('redirects legacy bookmarks to the workspace-owned dialog', async () => {
    const { default: ConnectionsPage } = await import('./page');

    expect(() => ConnectionsPage()).toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith('/workspace?settings=connections');
  });
});
