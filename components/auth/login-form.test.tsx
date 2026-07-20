// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  social: vi.fn(async () => ({ data: {}, error: null })),
  oauth2: vi.fn(async () => ({ data: {}, error: null })),
}));
const authCopy = {
  signInTitle: 'Sign in',
  signInGoogleDescription: 'Use Google to sign in to your account.',
  signInTelegramDescription: 'Use Google, or a Telegram identity already linked to your account.',
  continueGoogle: 'Continue with Google',
  openingGoogle: 'Opening Google…',
  continueTelegram: 'Continue with Telegram',
  openingTelegram: 'Opening Telegram…',
  signInError: 'Sign-in could not be started. Please try again.',
  secureRedirect: 'Secure redirect · callback preserved',
};
vi.mock('@/lib/auth-client', () => ({
  authClient: { signIn: { social: mocks.social, oauth2: mocks.oauth2 } },
}));
vi.mock('@/components/language-provider', () => ({
  useLanguage: () => ({ messages: { auth: authCopy } }),
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

  it('keeps the checkpoint retryable when a provider fails to open', async () => {
    mocks.social.mockRejectedValueOnce(new Error('provider unavailable'));
    render(<LoginForm telegramEnabled={false} />);

    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));

    await screen.findByRole('alert');
    const retry = screen.getByRole('button', { name: /continue with google/i });
    expect(retry.hasAttribute('disabled')).toBe(false);

    fireEvent.click(retry);
    await waitFor(() => expect(mocks.social).toHaveBeenCalledTimes(2));
  });
});
