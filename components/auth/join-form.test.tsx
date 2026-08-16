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
  joinCodeTitle: 'Join with an access code',
  joinCodeDescription: 'Enter the code shared by the workspace owner to request private beta access.',
  joinCodeLabel: 'Enrollment code',
  joinCodePlaceholder: 'JOIN-XXXXX-XXXXX-XXXXX-XXXXX',
  checkCode: 'Check code',
  checkingCode: 'Checking code…',
  codeAccepted: 'Code accepted.',
  codeRequired: 'Enter the enrollment code shared by the workspace owner.',
  codeInvalid: 'That enrollment code is invalid or no longer active.',
  codeExpired: 'That enrollment code has expired.',
  codeRotated: 'That enrollment code was rotated.',
  codeCapacityFull: 'The private beta is currently full.',
  codeRateLimited: 'Too many attempts.',
  codeCheckFailed: 'The enrollment code could not be checked.',
  enrollmentReady: 'Access confirmed. Continue with Google to finish enrollment.',
  enrollmentComplete: 'Enrollment complete.',
  enrollmentCompleteFailed: 'Enrollment could not be completed.',
  enrollmentCancelled: 'Google sign-in was cancelled.',
  authErrorTitle: 'Account access needs attention',
  authErrorSignupDisabled: 'This sign-in link is for existing members.',
  authErrorCancelled: 'Google sign-in was cancelled.',
  authErrorInvalidClaim: 'This enrollment has expired or was revoked.',
  authErrorCapacityFull: 'The private beta is currently full.',
  authErrorGeneric: 'We could not finish sign-in.',
  returnToJoin: 'Return to join',
  returnToSignIn: 'Return to sign in',
  continueEnrollment: 'Continue enrollment',
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
    window.history.replaceState({}, '', '/join');
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
      callbackURL: '/join/complete',
      newUserCallbackURL: '/join/complete',
      requestSignUp: true,
      errorCallbackURL: '/auth/error?flow=enrollment',
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
    expect(screen.getByRole('textbox', { name: /enrollment code/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /continue with google/i }).hasAttribute('disabled'))
      .toBe(true);

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

  it('resumes a server-validated claim after an OAuth error without asking for the code again', async () => {
    const returnTo = '/workspace?resume=7c67d7cf-47bd-4c5d-8dca-0980a9c27575';
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ready: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    render(<JoinForm checkExistingClaim returnTo={returnTo} />);

    expect(screen.getByText(/checking invitation/i)).toBeTruthy();
    await screen.findByText(/access confirmed/i);
    expect(fetch).toHaveBeenCalledWith('/api/enrollment/claim/status', expect.objectContaining({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    }));
    expect(screen.queryByRole('textbox', { name: /enrollment code/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    expect(signInSocial).toHaveBeenCalledWith(expect.objectContaining({
      callbackURL:
        '/join/complete?returnTo=%2Fworkspace%3Fresume%3D7c67d7cf-47bd-4c5d-8dca-0980a9c27575',
      errorCallbackURL:
        '/auth/error?flow=enrollment&returnTo=%2Fworkspace%3Fresume%3D7c67d7cf-47bd-4c5d-8dca-0980a9c27575',
    }));
  });

  it('shows code entry when the server finds no retryable claim', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ready: false }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    render(<JoinForm checkExistingClaim />);

    expect(await screen.findByRole('textbox', { name: /enrollment code/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /continue with google/i }).hasAttribute('disabled'))
      .toBe(true);
  });

  it('exchanges a fragment code for a claim, scrubs the URL, and completes through the join callback', async () => {
    const rawCode = 'join-abcde-fghjk-mnpqr-stuvw';
    const returnTo = '/workspace?resume=7c67d7cf-47bd-4c5d-8dca-0980a9c27575';
    window.history.replaceState({}, '', `/join#code=${rawCode}`);
    const { container } = render(<JoinForm checkExistingClaim returnTo={returnTo} />);

    await screen.findByText(/access confirmed/i);

    expect(fetch).toHaveBeenCalledWith('/api/enrollment/claim', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
    }));
    expect(fetch).not.toHaveBeenCalledWith('/api/enrollment/claim/status', expect.anything());
    const claimRequest = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(JSON.parse(String(claimRequest?.body))).toMatchObject({
      code: 'JOIN-ABCDE-FGHJK-MNPQR-STUVW',
    });
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/join');
    expect(container.textContent).not.toContain(rawCode);

    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    expect(signInSocial).toHaveBeenCalledWith({
      provider: 'google',
      callbackURL:
        '/join/complete?returnTo=%2Fworkspace%3Fresume%3D7c67d7cf-47bd-4c5d-8dca-0980a9c27575',
      newUserCallbackURL:
        '/join/complete?returnTo=%2Fworkspace%3Fresume%3D7c67d7cf-47bd-4c5d-8dca-0980a9c27575',
      requestSignUp: true,
      errorCallbackURL:
        '/auth/error?flow=enrollment&returnTo=%2Fworkspace%3Fresume%3D7c67d7cf-47bd-4c5d-8dca-0980a9c27575',
    });
  });

  it('accepts a manually entered shared code and maps rotated codes to safe guidance', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 'ENROLLMENT_CODE_ROTATED',
        error: 'internal detail that should not be rendered',
      }), { status: 400, headers: { 'content-type': 'application/json' } }));
    render(<JoinForm />);

    fireEvent.change(screen.getByRole('textbox', { name: /enrollment code/i }), {
      target: { value: 'join-abcde-fghjk-mnpqr-stuvw' },
    });
    fireEvent.click(screen.getByRole('button', { name: /check code/i }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/rotated/i);
    expect(screen.queryByText(/internal detail/i)).toBeNull();
  });

  it('keeps a successful manual claim ready after clearing the bearer code input', async () => {
    render(<JoinForm />);

    fireEvent.change(screen.getByRole('textbox', { name: /enrollment code/i }), {
      target: { value: 'join-abcde-fghjk-mnpqr-stuvw' },
    });
    fireEvent.click(screen.getByRole('button', { name: /check code/i }));

    await screen.findByText(/access confirmed/i);
    expect(screen.queryByRole('textbox', { name: /enrollment code/i })).toBeNull();
    expect(screen.getByRole('button', { name: /continue with google/i }).hasAttribute('disabled'))
      .toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
