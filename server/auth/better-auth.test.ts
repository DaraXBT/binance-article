import { beforeEach, describe, expect, it, vi } from 'vitest';

const { betterAuthMock, drizzleAdapterMock } = vi.hoisted(() => ({
  betterAuthMock: vi.fn((options: unknown) => ({ options, handler: vi.fn() })),
  drizzleAdapterMock: vi.fn(() => ({ adapter: 'drizzle' })),
}));

vi.mock('better-auth', () => ({ betterAuth: betterAuthMock }));
vi.mock('@better-auth/drizzle-adapter', () => ({ drizzleAdapter: drizzleAdapterMock }));

import { createBetterAuth } from './better-auth';

const environment = {
  secret: 's'.repeat(48),
  baseUrl: 'https://articles.example.com',
  googleClientId: 'google-client-id',
  googleClientSecret: 'google-client-secret',
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
      advanced: expect.objectContaining({
        ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      }),
      socialProviders: {
        google: expect.objectContaining({
          clientId: environment.googleClientId,
          scopes: ['openid', 'email', 'profile'],
          disableImplicitSignUp: true,
        }),
      },
    }));
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
