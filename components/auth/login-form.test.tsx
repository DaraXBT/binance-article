// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  social: vi.fn(async () => ({ data: {}, error: null })),
}));
const authCopy = {
  signInTitle: 'Sign in',
  signInGoogleDescription: 'Use Google to sign in to your account.',
  continueGoogle: 'Continue with Google',
  openingGoogle: 'Opening Google…',
  signInError: 'Sign-in could not be started. Please try again.',
  secureRedirect: 'Secure redirect · callback preserved',
};
vi.mock('@/lib/auth-client', () => ({
  authClient: { signIn: { social: mocks.social } },
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
    const { container } = render(<LoginForm />);
    const panel = container.querySelector('[data-auth-panel="login"]');

    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeTruthy();
    expect(panel?.className).toContain('border-0');
    expect(panel?.className).toContain('bg-transparent');
    expect(panel?.className).toContain('p-0');
    expect(panel?.className).toContain('shadow-none');
    expect(screen.queryByText(authCopy.secureRedirect)).toBeNull();
  });

  it('does not apply a global shadow to auth panels', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8');
    const authPanelRule = css.match(/\.studio-auth-panel\s*\{([^}]*)\}/)?.[1] ?? '';
    const boxShadow = authPanelRule.match(/box-shadow:\s*([^;]+)/)?.[1].trim();

    expect(boxShadow).toBe('none');
  });

  it('signs returning users in with Google without requesting signup', () => {
    const { container } = render(<LoginForm callbackURL="/articles/article_1" />);
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    expect(mocks.social).toHaveBeenCalledWith({
      provider: 'google', callbackURL: '/articles/article_1',
    });
    expect(container.querySelector('[data-provider-icon="google"]')).toBeTruthy();
    expect(container.querySelectorAll('[data-provider-icon]').length).toBe(1);
  });

  it('keeps the checkpoint retryable when a provider fails to open', async () => {
    mocks.social.mockRejectedValueOnce(new Error('provider unavailable'));
    render(<LoginForm />);

    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));

    await screen.findByRole('alert');
    const retry = screen.getByRole('button', { name: /continue with google/i });
    expect(retry.hasAttribute('disabled')).toBe(false);

    fireEvent.click(retry);
    await waitFor(() => expect(mocks.social).toHaveBeenCalledTimes(2));
  });
});
