// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  social: vi.fn(async () => ({ data: {}, error: null })),
  oauth2: vi.fn(async () => ({ data: {}, error: null })),
}));
vi.mock('@/lib/auth-client', () => ({
  authClient: { signIn: { social: mocks.social, oauth2: mocks.oauth2 } },
}));

import { LoginForm } from './login-form';

describe('LoginForm', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('exposes the sign-in title as the page heading', () => {
    render(<LoginForm telegramEnabled={false} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeTruthy();
  });

  it('signs returning users in with Google without requesting signup', () => {
    render(<LoginForm callbackURL="/articles/article_1" telegramEnabled />);
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    expect(mocks.social).toHaveBeenCalledWith({
      provider: 'google', callbackURL: '/articles/article_1',
    });
  });

  it('signs in only an already-linked Telegram account', () => {
    render(<LoginForm callbackURL="/settings/connections" telegramEnabled />);
    fireEvent.click(screen.getByRole('button', { name: /continue with telegram/i }));
    expect(mocks.oauth2).toHaveBeenCalledWith({
      providerId: 'telegram',
      callbackURL: '/settings/connections',
      requestSignUp: false,
    });
    expect(screen.getByText(/already linked/i)).toBeTruthy();
  });

  it('does not offer Telegram when the deployment has no Telegram OAuth client', () => {
    render(<LoginForm telegramEnabled={false} />);

    expect(screen.getByRole('button', { name: /continue with google/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /telegram/i })).toBeNull();
    expect(screen.queryByText(/already linked/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    expect(mocks.social).toHaveBeenCalledWith({
      provider: 'google', callbackURL: '/workspace',
    });
  });
});
