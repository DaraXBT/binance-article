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

import {
  getOptionalActivePageUser,
  normalizeLoginCallback,
  requireActivePageUser,
} from './page-authorization';

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

  it('renders the anonymous home without initializing auth when no session cookie exists', async () => {
    mocks.headers.mockResolvedValueOnce(new Headers({ cookie: 'theme=dark; locale=en' }));

    await expect(getOptionalActivePageUser()).resolves.toBeNull();
    expect(mocks.requireActiveUser).not.toHaveBeenCalled();
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

  it('lets the public home distinguish logout from disabled or unavailable auth', async () => {
    const { AppError } = await import('@/server/http/errors');
    mocks.requireActiveUser.mockRejectedValueOnce(new AppError({
      code: 'AUTH_REQUIRED', message: 'Authentication is required.', status: 401,
    }));
    await expect(getOptionalActivePageUser()).resolves.toBeNull();

    mocks.requireActiveUser.mockRejectedValueOnce(new AppError({
      code: 'ACCOUNT_DISABLED', message: 'This account is disabled.', status: 403,
    }));
    await expect(getOptionalActivePageUser()).rejects.toThrow(
      'REDIRECT:/login?error=account_disabled',
    );

    mocks.requireActiveUser.mockRejectedValueOnce(new Error('database offline'));
    await expect(getOptionalActivePageUser()).rejects.toThrow('database offline');
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
    for (const value of [
      'https://evil.example',
      '//evil.example',
      '/\\evil',
      'relative',
      '/login',
      '/login/provider-callback',
      '/join/invite',
      '/foo/..//evil.example',
      '/%2e%2e//evil.example',
    ]) {
      expect(normalizeLoginCallback(value)).toBe('/workspace');
    }
  });
});
