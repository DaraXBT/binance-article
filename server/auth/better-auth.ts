import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { genericOAuth } from 'better-auth/plugins';
import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';

import type { AppDatabase } from '@/server/db/client';
import * as databaseSchema from '@/server/db/schema';

import {
  type AuthEnvironment,
  buildAuthPolicy,
  telegramClaimsToProfile,
} from './auth-policy';

const TELEGRAM_JWKS_URL = 'https://oauth.telegram.org/.well-known/jwks.json';

const telegramKeySet = createRemoteJWKSet(new URL(TELEGRAM_JWKS_URL), {
  [customFetch]: (url, init) => fetch(url, {
    ...init,
    redirect: 'error',
  }),
});

export interface AuthEnrollmentGate {
  beforeUserCreate(user: unknown, context: unknown): Promise<void> | void;
  afterUserCreate(user: unknown, context: unknown): Promise<void> | void;
}

export interface CreateBetterAuthInput {
  database: AppDatabase;
  environment: AuthEnvironment;
  enrollmentGate: AuthEnrollmentGate;
}

async function getVerifiedTelegramProfile(
  tokens: { idToken?: string },
  clientId: string,
) {
  if (!tokens.idToken) return null;

  const { payload } = await jwtVerify(tokens.idToken, telegramKeySet, {
    issuer: 'https://oauth.telegram.org',
    audience: clientId,
    algorithms: ['RS256', 'ES256', 'EdDSA'],
  });
  const profile = telegramClaimsToProfile(payload);
  return {
    ...profile,
    image: profile.image ?? undefined,
  };
}

export function createBetterAuth({
  database,
  environment,
  enrollmentGate,
}: CreateBetterAuthInput) {
  const policy = buildAuthPolicy(environment);
  const telegram = policy.telegram;
  const plugins = telegram ? [
    genericOAuth({
      config: [{
        ...telegram,
        authentication: 'basic',
        getUserInfo: (tokens) => getVerifiedTelegramProfile(tokens, telegram.clientId),
        mapProfileToUser: (profile) => ({
          id: profile.id,
          name: profile.name,
          email: profile.email,
          emailVerified: profile.emailVerified,
          image: profile.image,
        }),
      }],
    }),
  ] : [];

  return betterAuth({
    database: drizzleAdapter(database, {
      provider: 'pg',
      schema: databaseSchema,
      usePlural: false,
    }),
    secret: environment.secret,
    baseURL: environment.baseUrl,
    trustedOrigins: [environment.baseUrl],
    emailAndPassword: {
      enabled: false,
    },
    session: policy.session,
    account: policy.account,
    advanced: {
      useSecureCookies: environment.secureCookies,
      defaultCookieAttributes: policy.cookieAttributes,
    },
    user: {
      additionalFields: {
        status: {
          type: 'string',
          required: true,
          defaultValue: 'active',
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
    plugins,
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
