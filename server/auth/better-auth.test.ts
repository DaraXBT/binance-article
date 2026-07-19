import { beforeEach, describe, expect, it, vi } from 'vitest';

const { betterAuthMock, drizzleAdapterMock, genericOAuthMock } = vi.hoisted(() => ({
  betterAuthMock: vi.fn((options: unknown) => ({ options, handler: vi.fn() })),
  drizzleAdapterMock: vi.fn(() => ({ adapter: 'drizzle' })),
  genericOAuthMock: vi.fn((options: unknown) => ({ plugin: 'generic-oauth', options })),
}));

vi.mock('better-auth', () => ({ betterAuth: betterAuthMock }));
vi.mock('@better-auth/drizzle-adapter', () => ({ drizzleAdapter: drizzleAdapterMock }));
vi.mock('better-auth/plugins', () => ({ genericOAuth: genericOAuthMock }));

import { createBetterAuth } from './better-auth';

const environment = {
  secret: 's'.repeat(48),
  baseUrl: 'https://articles.example.com',
  googleClientId: 'google-client-id',
  googleClientSecret: 'google-client-secret',
  telegramClientId: 'telegram-client-id',
  telegramClientSecret: 'telegram-client-secret',
  secureCookies: true,
};

describe('Better Auth factory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses Drizzle/PostgreSQL and the reviewed OAuth/session policy', () => {
    const database = { select: vi.fn() } as never;
    const enrollmentGate = {
      beforeUserCreate: vi.fn(),
      afterUserCreate: vi.fn(),
    };

    createBetterAuth({ database, environment, enrollmentGate });

    expect(drizzleAdapterMock).toHaveBeenCalledWith(database, expect.objectContaining({
      provider: 'pg',
      usePlural: false,
      schema: expect.any(Object),
    }));
    expect(betterAuthMock).toHaveBeenCalledWith(expect.objectContaining({
      secret: environment.secret,
      baseURL: environment.baseUrl,
      session: expect.objectContaining({ expiresIn: 60 * 60 * 24 * 7 }),
      account: expect.objectContaining({ encryptOAuthTokens: true }),
      socialProviders: {
        google: expect.objectContaining({
          clientId: environment.googleClientId,
          scopes: ['openid', 'email', 'profile'],
          disableImplicitSignUp: true,
        }),
      },
    }));
  });

  it('registers Telegram as strict OIDC with PKCE and profile-only scopes', () => {
    createBetterAuth({
      database: {} as never,
      environment,
      enrollmentGate: { beforeUserCreate: vi.fn(), afterUserCreate: vi.fn() },
    });

    expect(genericOAuthMock).toHaveBeenCalledWith({
      config: [expect.objectContaining({
        providerId: 'telegram',
        discoveryUrl: 'https://oauth.telegram.org/.well-known/openid-configuration',
        issuer: 'https://oauth.telegram.org',
        requireIssuerValidation: true,
        scopes: ['openid', 'profile'],
        pkce: true,
        disableImplicitSignUp: true,
        mapProfileToUser: expect.any(Function),
      })],
    });
  });

  it('calls the invitation enrollment gate before and after user creation', async () => {
    const enrollmentGate = {
      beforeUserCreate: vi.fn(async () => undefined),
      afterUserCreate: vi.fn(async () => undefined),
    };
    createBetterAuth({ database: {} as never, environment, enrollmentGate });

    const options = betterAuthMock.mock.calls[0]?.[0] as {
      databaseHooks: {
        user: {
          create: {
            before: (user: unknown, context: unknown) => Promise<unknown>;
            after: (user: unknown, context: unknown) => Promise<void>;
          };
        };
      };
    };
    const candidate = { id: 'user_1', email: 'invited@example.com' };
    const context = { request: new Request('https://articles.example.com/api/auth/callback') };

    await options.databaseHooks.user.create.before(candidate, context);
    await options.databaseHooks.user.create.after(candidate, context);

    expect(enrollmentGate.beforeUserCreate).toHaveBeenCalledWith(candidate, context);
    expect(enrollmentGate.afterUserCreate).toHaveBeenCalledWith(candidate, context);
  });

  it('marks role and status as server-controlled user fields', () => {
    createBetterAuth({
      database: {} as never,
      environment,
      enrollmentGate: { beforeUserCreate: vi.fn(), afterUserCreate: vi.fn() },
    });

    const options = betterAuthMock.mock.calls[0]?.[0] as {
      user: { additionalFields: Record<string, { input: boolean; defaultValue: string }> };
    };
    expect(options.user.additionalFields).toMatchObject({
      status: { input: false, defaultValue: 'active' },
      role: { input: false, defaultValue: 'user' },
    });
  });
});
