// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
}));

const authCopy = {
  enrollmentComplete: 'Enrollment complete. Opening your workspace…',
  enrollmentCompleteFailed: 'Enrollment could not be completed.',
  continueEnrollment: 'Continue enrollment',
  returnToJoin: 'Return to join',
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock('@/components/language-provider', () => ({
  useLanguage: () => ({ messages: { auth: authCopy } }),
}));

vi.mock('@/components/auth/auth-error-panel', () => ({
  AuthErrorPanel: ({ error }: { error?: string | null }) => (
    <div role="alert">Friendly error for {error}</div>
  ),
}));

import { EnrollmentCompletion, internalDestination } from './enrollment-completion';

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('EnrollmentCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(async () => response({ completed: true })));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('idempotently completes the claim and opens the personal workspace', async () => {
    const returnTo = '/workspace?resume=7c67d7cf-47bd-4c5d-8dca-0980a9c27575';
    render(<EnrollmentCompletion returnTo={returnTo} />);

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(returnTo));
    expect(fetch).toHaveBeenCalledWith('/api/enrollment/complete', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
    }));
  });

  it('keeps a transient completion failure retryable', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ code: 'ENROLLMENT_FINALIZE_FAILED' }, 503))
      .mockResolvedValueOnce(response({ completed: true }));
    render(<EnrollmentCompletion />);

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      authCopy.enrollmentCompleteFailed,
    );
    fireEvent.click(screen.getByRole('button', { name: authCopy.continueEnrollment }));

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/workspace'));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not call completion after an OAuth provider error', () => {
    render(<EnrollmentCompletion providerError="signup_disabled" />);

    expect(screen.getByRole('alert').textContent).toContain('Friendly error');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts only same-origin relative completion redirects', () => {
    expect(internalDestination('/workspace?welcome=1')).toBe('/workspace?welcome=1');
    expect(internalDestination('//evil.example')).toBe('/workspace');
    expect(internalDestination('https://evil.example')).toBe('/workspace');
  });

  it('falls back to the personal dashboard when the requested completion target is unsafe', async () => {
    render(<EnrollmentCompletion returnTo="https://evil.example/steal" />);

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/workspace'));
  });
});
