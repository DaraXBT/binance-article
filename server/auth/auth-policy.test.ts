import { describe, expect, it } from 'vitest';

import {
  AUTH_SESSION_MAX_AGE_SECONDS,
  buildAuthPolicy,
  hasUsableAuthEnvironment,
  parseAuthEnvironment,
} from './auth-policy';

const validEnv = {
  BETTER_AUTH_SECRET: 's'.repeat(48),
  BETTER_AUTH_URL: 'https://articles.example.com',
  GOOGLE_CLIENT_ID: 'google-client-id',
  GOOGLE_CLIENT_SECRET: 'google-client-secret',
};

describe('authentication environment', () => {
  it('requires the core server-side auth configuration without returning values in errors', () => {
    const requiredKeys = [
      'BETTER_AUTH_SECRET',
      'BETTER_AUTH_URL',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
    ] as const;
    for (const key of requiredKeys) {
      expect(() => parseAuthEnvironment({ ...validEnv, [key]: '' })).toThrow(key);
    }
  });

  it('requires HTTPS outside explicit localhost development', () => {
    expect(() => parseAuthEnvironment({
      ...validEnv,
      BETTER_AUTH_URL: 'http://articles.example.com',
    })).toThrow(/HTTPS/i);
    expect(parseAuthEnvironment({
      ...validEnv,
      BETTER_AUTH_URL: 'http://localhost:3000',
    }).baseUrl).toBe('http://localhost:3000');
  });

  it('requires a high-entropy Better Auth secret', () => {
    expect(() => parseAuthEnvironment({ ...validEnv, BETTER_AUTH_SECRET: 'too-short' }))
      .toThrow(/32/);
  });

  it('reports auth readiness without weakening the strict parser or exposing configuration', () => {
    expect(hasUsableAuthEnvironment(validEnv)).toBe(true);
    expect(hasUsableAuthEnvironment({ ...validEnv, BETTER_AUTH_SECRET: '' })).toBe(false);
    expect(hasUsableAuthEnvironment({ ...validEnv, BETTER_AUTH_URL: 'not-a-url' })).toBe(false);
    expect(hasUsableAuthEnvironment({})).toBe(false);
  });
});

describe('Better Auth security policy', () => {
  const policy = buildAuthPolicy(parseAuthEnvironment(validEnv));

  it('uses seven-day database-backed sessions and secure HttpOnly OAuth-compatible cookies', () => {
    expect(AUTH_SESSION_MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 7);
    expect(policy.session).toMatchObject({
      expiresIn: AUTH_SESSION_MAX_AGE_SECONDS,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    });
    expect(policy.cookieAttributes).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
  });

  it('encrypts OAuth tokens and disables account linking for the single Google provider', () => {
    expect(policy.account).toEqual({
      encryptOAuthTokens: true,
      storeStateStrategy: 'database',
      accountLinking: {
        enabled: false,
        disableImplicitLinking: true,
        allowDifferentEmails: false,
      },
    });
  });

  it('requests only identity scopes from Google and requires explicit invited signup', () => {
    expect(policy.google).toMatchObject({
      scopes: ['openid', 'email', 'profile'],
      disableImplicitSignUp: true,
    });
  });

  it('routes OAuth failures to the owned, sanitized error experience', () => {
    expect(policy.errorURL).toBe('https://articles.example.com/auth/error');
  });

});
