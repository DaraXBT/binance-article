import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  headers: vi.fn(async () => new Headers({ cookie: 'better-auth.session_token=opaque' })),
  requireActiveUser: vi.fn<(request: Request) => Promise<{
    id: string;
    status: string;
  }>>(async () => ({ id: 'user_1', status: 'active' })),
  redirect: vi.fn((location: string) => {
    throw new Error(`REDIRECT:${location}`);
  }),
}));

vi.mock('next/headers', () => ({ headers: mocks.headers }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('./authorization', () => ({ requireActiveUser: mocks.requireActiveUser }));

import { normalizeLoginCallback, requireActivePageUser } from './page-authorization';

describe('private page authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveUser.mockResolvedValue({ id: 'user_1', status: 'active' });
  });

  it('authorizes with the current database-backed cookie session', async () => {
    await expect(requireActivePageUser('/new')).resolves.toMatchObject({ id: 'user_1' });
    const request = mocks.requireActiveUser.mock.calls[0]?.[0] as Request;
    expect(request.headers.get('cookie')).toBe('better-auth.session_token=opaque');
  });

  it('redirects a logged-out visitor with a safe local callback', async () => {
    const { AppError } = await import('@/server/http/errors');
    mocks.requireActiveUser.mockRejectedValueOnce(new AppError({
      code: 'AUTH_REQUIRED', message: 'Authentication is required.', status: 401,
    }));
    await expect(requireActivePageUser('/articles/article_1?tab=slides')).rejects.toThrow(
      'REDIRECT:/login?callbackURL=%2Farticles%2Farticle_1%3Ftab%3Dslides',
    );
  });

  it('does not disguise a disabled account or infrastructure outage as logout', async () => {
    const { AppError } = await import('@/server/http/errors');
    mocks.requireActiveUser.mockRejectedValueOnce(new AppError({
      code: 'ACCOUNT_DISABLED', message: 'This account is disabled.', status: 403,
    }));
    await expect(requireActivePageUser('/')).rejects.toThrow(
      'REDIRECT:/login?error=account_disabled',
    );

    mocks.requireActiveUser.mockRejectedValueOnce(new Error('database offline'));
    await expect(requireActivePageUser('/')).rejects.toThrow('database offline');
  });

  it('accepts only bounded same-origin callback paths', () => {
    expect(normalizeLoginCallback('/articles/a?tab=slides')).toBe('/articles/a?tab=slides');
    for (const value of ['https://evil.example', '//evil.example', '/\\evil', 'relative', '/login']) {
      expect(normalizeLoginCallback(value)).toBe('/workspace');
    }
  });
});
