import { describe, expect, it } from 'vitest';

import {
  AUTH_SESSION_MAX_AGE_SECONDS,
  TELEGRAM_OIDC_DISCOVERY_URL,
  buildAuthPolicy,
  hasUsableAuthEnvironment,
  parseAuthEnvironment,
  telegramClaimsToProfile,
} from './auth-policy';

const validEnv = {
  BETTER_AUTH_SECRET: 's'.repeat(48),
  BETTER_AUTH_URL: 'https://articles.example.com',
  GOOGLE_CLIENT_ID: 'google-client-id',
  GOOGLE_CLIENT_SECRET: 'google-client-secret',
  TELEGRAM_CLIENT_ID: '123456789',
  TELEGRAM_CLIENT_SECRET: 'telegram-client-secret',
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

  it('allows Telegram to be disabled but rejects a partial credential pair', () => {
    const {
      TELEGRAM_CLIENT_ID: _telegramClientId,
      TELEGRAM_CLIENT_SECRET: _telegramClientSecret,
      ...googleOnlyEnv
    } = validEnv;

    expect(parseAuthEnvironment(googleOnlyEnv).telegram).toBeNull();
    expect(() => parseAuthEnvironment({
      ...googleOnlyEnv,
      TELEGRAM_CLIENT_ID: '123456789',
    })).toThrow(/TELEGRAM_CLIENT_ID and TELEGRAM_CLIENT_SECRET must be set together/);
    expect(() => parseAuthEnvironment({
      ...googleOnlyEnv,
      TELEGRAM_CLIENT_SECRET: 'telegram-client-secret',
    })).toThrow(/TELEGRAM_CLIENT_ID and TELEGRAM_CLIENT_SECRET must be set together/);
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

  it('encrypts OAuth tokens and disables implicit account linking', () => {
    expect(policy.account).toEqual({
      encryptOAuthTokens: true,
      storeStateStrategy: 'database',
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: true,
      },
    });
  });

  it('requests only identity scopes from Google and requires explicit invited signup', () => {
    expect(policy.google).toMatchObject({
      scopes: ['openid', 'email', 'profile'],
      disableImplicitSignUp: true,
    });
  });

  it('uses Telegram OIDC discovery with PKCE and never requests phone access', () => {
    expect(policy.telegram).toMatchObject({
      providerId: 'telegram',
      discoveryUrl: TELEGRAM_OIDC_DISCOVERY_URL,
      issuer: 'https://oauth.telegram.org',
      requireIssuerValidation: true,
      scopes: ['openid', 'profile'],
      pkce: true,
      disableImplicitSignUp: true,
      disableSignUp: true,
    });
    expect(policy.telegram?.scopes).not.toContain('phone');
  });

  it('omits the Telegram policy when the optional provider is disabled', () => {
    const {
      TELEGRAM_CLIENT_ID: _telegramClientId,
      TELEGRAM_CLIENT_SECRET: _telegramClientSecret,
      ...googleOnlyEnv
    } = validEnv;
    expect(buildAuthPolicy(parseAuthEnvironment(googleOnlyEnv)).telegram).toBeNull();
  });
});

describe('Telegram OIDC claims', () => {
  it('maps only stable profile metadata and creates no trusted email identity', () => {
    const profile = telegramClaimsToProfile({
      sub: '998877',
      name: 'Satoshi',
      preferred_username: 'satoshi',
      picture: 'https://cdn.telegram.org/avatar.jpg',
      phone_number: '+85512345678',
    });

    expect(profile).toEqual({
      id: '998877',
      name: 'Satoshi',
      email: 'telegram-998877@login.invalid',
      emailVerified: false,
      image: 'https://cdn.telegram.org/avatar.jpg',
    });
    expect(JSON.stringify(profile)).not.toContain('+85512345678');
  });

  it('rejects malformed Telegram subjects and unsafe avatar URLs', () => {
    expect(() => telegramClaimsToProfile({ sub: '../admin', name: 'Bad' })).toThrow(/subject/i);
    expect(telegramClaimsToProfile({
      sub: '123',
      name: 'User',
      picture: 'javascript:alert(1)',
    }).image).toBeNull();
  });
});
