import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireActivePageUser: vi.fn(async () => ({ id: 'user_1', status: 'active' })),
}));

vi.mock('@/server/auth/page-authorization', () => ({
  requireActivePageUser: mocks.requireActivePageUser,
}));
describe('/settings/connections', () => {
  it('is wrapped by the authenticated connections layout', async () => {
    const { default: ConnectionsLayout } = await import('./layout');
    const child = { type: 'child' } as never;
    await expect(ConnectionsLayout({ children: child })).resolves.toBe(child);
    expect(mocks.requireActivePageUser).toHaveBeenCalledWith('/settings/connections');
  });

  it('uses the web publisher pairing surface as its only connection workflow', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/settings/connections/page.tsx'), 'utf8');

    expect(source).toContain('PublisherDevicePairingCard');
    expect(source).toContain('Browser publisher');
    expect(source).not.toMatch(/Telegram/i);
  });
});
