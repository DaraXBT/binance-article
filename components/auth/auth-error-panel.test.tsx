// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const authCopy = {
  authErrorTitle: 'Account access needs attention',
  authErrorSignupDisabled: 'Use an enrollment link to create an account.',
  authErrorCancelled: 'Google sign-in was cancelled.',
  authErrorInvalidClaim: 'This enrollment has expired or was revoked.',
  authErrorCapacityFull: 'The private beta is currently full.',
  authErrorAccountDisabled: 'This account is suspended or revoked.',
  authErrorGeneric: 'We could not finish sign-in.',
  returnToJoin: 'Return to join',
  returnToSignIn: 'Return to sign in',
};

vi.mock('@/components/language-provider', () => ({
  useLanguage: () => ({ messages: { auth: authCopy } }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.ComponentProps<'a'>) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { AuthErrorPanel, classifyAuthError } from './auth-error-panel';

describe('AuthErrorPanel', () => {
  afterEach(() => cleanup());

  it('maps signup_disabled to enrollment guidance without echoing provider details', () => {
    const returnTo = '/workspace?resume=7c67d7cf-47bd-4c5d-8dca-0980a9c27575';
    render(<AuthErrorPanel error="signup_disabled" returnTo={returnTo} />);

    expect(screen.getByRole('alert').textContent).toContain(authCopy.authErrorSignupDisabled);
    expect(screen.getByRole('link', { name: authCopy.returnToJoin }).getAttribute('href')).toBe(
      '/join?returnTo=%2Fworkspace%3Fresume%3D7c67d7cf-47bd-4c5d-8dca-0980a9c27575',
    );
    expect(screen.queryByText('signup_disabled')).toBeNull();
  });

  it('falls back to the personal dashboard when a signup error carries an unsafe return target', () => {
    render(<AuthErrorPanel error="signup_disabled" returnTo="https://evil.example/steal" />);

    expect(screen.getByRole('link', { name: authCopy.returnToJoin }).getAttribute('href')).toBe(
      '/join?returnTo=%2Fworkspace',
    );
  });

  it('handles a provider code copied with a trailing query delimiter', () => {
    expect(classifyAuthError('signup_disabled?')).toBe('signup-disabled');
  });

  it('uses an allowlisted generic message for unknown provider errors', () => {
    render(<AuthErrorPanel error="provider_database_internal_secret" />);

    expect(screen.getByRole('alert').textContent).toContain(authCopy.authErrorGeneric);
    expect(screen.queryByText(/internal_secret/i)).toBeNull();
  });

  it('classifies enrollment and account lifecycle failures', () => {
    expect(classifyAuthError('ENROLLMENT_CLAIM_REVOKED')).toBe('claim-invalid');
    expect(classifyAuthError('ENROLLMENT_CAPACITY_FULL')).toBe('capacity-full');
    expect(classifyAuthError('account_suspended')).toBe('account-disabled');
    expect(classifyAuthError(null)).toBeNull();
  });
});
