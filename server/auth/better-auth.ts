import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';

import type { AppDatabase } from '@/server/db/client';
import * as databaseSchema from '@/server/db/schema';

import { type AuthEnvironment, buildAuthPolicy } from './auth-policy';

export interface AuthEnrollmentGate {
  beforeUserCreate(user: unknown, context: unknown): Promise<void> | void;
  afterUserCreate(user: unknown, context: unknown): Promise<void> | void;
}

export interface CreateBetterAuthInput {
  database: AppDatabase;
  environment: AuthEnvironment;
  enrollmentGate: AuthEnrollmentGate;
}

export function createBetterAuth({
  database,
  environment,
  enrollmentGate,
}: CreateBetterAuthInput) {
  const policy = buildAuthPolicy(environment);

  return betterAuth({
    database: drizzleAdapter(database, {
      provider: 'pg',
      schema: databaseSchema,
      usePlural: false,
    }),
    secret: environment.secret,
    baseURL: environment.baseUrl,
    trustedOrigins: [environment.baseUrl],
    onAPIError: {
      errorURL: policy.errorURL,
    },
    emailAndPassword: {
      enabled: false,
    },
    session: policy.session,
    account: policy.account,
    advanced: {
      useSecureCookies: environment.secureCookies,
      defaultCookieAttributes: policy.cookieAttributes,
      ipAddress: {
        ipAddressHeaders: ['cf-connecting-ip'],
      },
    },
    user: {
      additionalFields: {
        status: {
          type: 'string',
          required: true,
          defaultValue: 'pending',
          input: false,
        },
        role: {
          type: 'string',
          required: true,
          defaultValue: 'user',
          input: false,
        },
      },
    },
    socialProviders: {
      google: policy.google,
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => {
            await enrollmentGate.beforeUserCreate(user, context);
            return { data: user };
          },
          after: async (user, context) => {
            await enrollmentGate.afterUserCreate(user, context);
          },
        },
      },
    },
  });
}

export type AppAuth = ReturnType<typeof createBetterAuth>;
