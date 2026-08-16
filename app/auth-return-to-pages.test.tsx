import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { AuthErrorPanel } from '@/components/auth/auth-error-panel';
import { EnrollmentCompletion } from '@/components/auth/enrollment-completion';
import { JoinForm } from '@/components/auth/join-form';
import { LoginForm } from '@/components/auth/login-form';

import AuthErrorPage from './auth/error/page';
import JoinCompletePage from './join/complete/page';
import JoinPage from './join/page';
import LoginPage from './login/page';

type ElementProps = Record<string, unknown> & { children?: ReactNode };

function findElement(
  node: ReactNode,
  type: ReactElement['type'],
): ReactElement<ElementProps> {
  if (Array.isArray(node)) {
    for (const child of node) {
      try {
        return findElement(child, type);
      } catch {
        // Continue through sibling branches until the requested boundary is found.
      }
    }
  }
  if (isValidElement<ElementProps>(node)) {
    if (node.type === type) return node;
    if (node.props.children !== undefined) return findElement(node.props.children, type);
  }
  throw new Error('Expected auth journey element was not found.');
}

describe('auth returnTo page boundaries', () => {
  const resumeTarget = '/workspace?resume=7c67d7cf-47bd-4c5d-8dca-0980a9c27575';

  it('preserves one sanitized resume target across login, errors, join, and completion', async () => {
    const login = await LoginPage({
      searchParams: Promise.resolve({ callbackURL: resumeTarget }),
    });

    const error = await AuthErrorPage({
      searchParams: Promise.resolve({
        error: 'signup_disabled',
        flow: 'sign-in',
        returnTo: resumeTarget,
      }),
    });

    const join = await JoinPage({
      searchParams: Promise.resolve({ returnTo: resumeTarget }),
    });

    const completion = await JoinCompletePage({
      searchParams: Promise.resolve({ returnTo: resumeTarget }),
    });

    expect([
      findElement(login, LoginForm).props.callbackURL,
      findElement(error, AuthErrorPanel).props.returnTo,
      findElement(join, JoinForm).props.returnTo,
      findElement(completion, EnrollmentCompletion).props.returnTo,
    ]).toEqual([
      resumeTarget,
      resumeTarget,
      resumeTarget,
      resumeTarget,
    ]);
    expect(findElement(join, JoinForm).props.checkExistingClaim).toBe(true);
  });

  it.each([
    'https://evil.example/steal',
    '//evil.example/steal',
  ])('collapses unsafe return target %s to the personal dashboard', async (unsafeTarget) => {
    const login = await LoginPage({
      searchParams: Promise.resolve({ callbackURL: unsafeTarget }),
    });

    const error = await AuthErrorPage({
      searchParams: Promise.resolve({ error: 'signup_disabled', returnTo: unsafeTarget }),
    });

    const join = await JoinPage({
      searchParams: Promise.resolve({ returnTo: unsafeTarget }),
    });

    const completion = await JoinCompletePage({
      searchParams: Promise.resolve({ returnTo: unsafeTarget }),
    });

    expect([
      findElement(login, LoginForm).props.callbackURL,
      findElement(error, AuthErrorPanel).props.returnTo,
      findElement(join, JoinForm).props.returnTo,
      findElement(completion, EnrollmentCompletion).props.returnTo,
    ]).toEqual([
      '/workspace',
      '/workspace',
      '/workspace',
      '/workspace',
    ]);
  });
});
