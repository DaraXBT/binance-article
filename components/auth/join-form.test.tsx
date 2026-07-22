// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const signInSocial = vi.hoisted(() => vi.fn(async () => ({ data: {}, error: null })));
const authCopy = {
  signInTitle: 'Sign in',
  signInGoogleDescription: 'Use Google to sign in to your account.',
  continueGoogle: 'Continue with Google',
  openingGoogle: 'Opening Google…',
  signInError: 'Sign-in could not be started. Please try again.',
  secureRedirect: 'Secure redirect · callback preserved',
  joinTitle: 'Join the private beta',
  invitationMissing: 'This invitation link is invalid or missing.',
  invitationExpired: 'The invitation is invalid or expired.',
  checkingInvitation: 'Checking invitation…',
  invitationFor: (email: string) => `This invitation is for ${email}.`,
  enrollmentError: 'Google enrollment could not be started. Please try again.',
  checkInvitationAgain: 'Check invitation again',
  alreadyEnrolled: 'Already enrolled?',
};
vi.mock('@/lib/auth-client', () => ({
  authClient: { signIn: { social: signInSocial } },
}));
vi.mock('@/components/language-provider', () => ({
  useLanguage: () => ({ messages: { auth: authCopy } }),
}));

import { JoinForm } from './join-form';

describe('JoinForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      email: 'invited@example.com',
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('validates the invitation server-side before enabling explicit Google signup', async () => {
    const { container } = render(<JoinForm token="invite_token_value_12345678901234567890" />);

    expect(screen.getByText(/checking invitation/i)).toBeTruthy();
    expect(container.querySelector('[data-auth-panel="join"]')?.className)
      .toContain('shadow-none');
    await screen.findByText(/invited@example.com/i);
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));

    expect(fetch).toHaveBeenCalledWith('/api/invitations/accept', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      body: JSON.stringify({ token: 'invite_token_value_12345678901234567890' }),
    }));
    expect(signInSocial).toHaveBeenCalledWith({
      provider: 'google',
      callbackURL: '/workspace',
      newUserCallbackURL: '/workspace',
      requestSignUp: true,
    });
  });

  it('does not render the raw token after validation', async () => {
    const token = 'invite_token_value_12345678901234567890';
    const { container } = render(<JoinForm token={token} />);
    await screen.findByText(/invited@example.com/i);
    expect(container.textContent).not.toContain(token);
  });

  it('fails closed for a missing or rejected invitation', async () => {
    const { rerender } = render(<JoinForm token={null} />);
    expect(screen.getByText(/invalid or missing/i)).toBeTruthy();

    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      error: 'The invitation is invalid or expired.',
    }), { status: 400, headers: { 'content-type': 'application/json' } }));
    rerender(<JoinForm token="rejected_token_value_123456789012345" />);
    await waitFor(() => expect(screen.getByText(/invalid or expired/i)).toBeTruthy());
    expect(signInSocial).not.toHaveBeenCalled();
  });

  it('can re-check an invitation after a transient validation failure', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Connection interrupted'));
    render(<JoinForm token="invite_token_value_12345678901234567890" />);

    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: /check invitation again/i }));

    await screen.findByText(/invited@example.com/i);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole('button', { name: /continue with google/i }).hasAttribute('disabled'),
    ).toBe(false);
  });

  it('keeps Google enrollment retryable when the provider fails to open', async () => {
    signInSocial.mockRejectedValueOnce(new Error('Provider unavailable'));
    render(<JoinForm token="invite_token_value_12345678901234567890" />);

    await screen.findByText(/invited@example.com/i);
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    await screen.findByRole('alert');

    const retry = screen.getByRole('button', { name: /continue with google/i });
    expect(retry.hasAttribute('disabled')).toBe(false);
    fireEvent.click(retry);

    await waitFor(() => expect(signInSocial).toHaveBeenCalledTimes(2));
  });
});
