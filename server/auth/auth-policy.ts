import { z } from 'zod';

export const AUTH_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

const AUTH_SECRET_MIN_LENGTH = 32;

const RequiredEnvironmentValue = (name: string) => z.string()
  .trim()
  .min(1, `${name} is required.`);

const AuthEnvironmentSchema = z.object({
  BETTER_AUTH_SECRET: RequiredEnvironmentValue('BETTER_AUTH_SECRET')
    .min(AUTH_SECRET_MIN_LENGTH, `BETTER_AUTH_SECRET must contain at least ${AUTH_SECRET_MIN_LENGTH} characters.`),
  BETTER_AUTH_URL: RequiredEnvironmentValue('BETTER_AUTH_URL'),
  GOOGLE_CLIENT_ID: RequiredEnvironmentValue('GOOGLE_CLIENT_ID'),
  GOOGLE_CLIENT_SECRET: RequiredEnvironmentValue('GOOGLE_CLIENT_SECRET'),
}).passthrough();

export interface AuthEnvironment {
  secret: string;
  baseUrl: string;
  googleClientId: string;
  googleClientSecret: string;
  secureCookies: boolean;
}

function parseBaseUrl(value: string): { baseUrl: string; secure: boolean } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('BETTER_AUTH_URL must be a valid absolute URL.');
  }

  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('BETTER_AUTH_URL must contain only the application origin.');
  }

  const isLocal = url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '::1' ||
    url.hostname.endsWith('.localhost');
  if (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:')) {
    throw new Error('BETTER_AUTH_URL must use HTTPS outside localhost development.');
  }

  return {
    baseUrl: url.origin,
    secure: url.protocol === 'https:',
  };
}

export function parseAuthEnvironment(input: Record<string, string | undefined>): AuthEnvironment {
  const parsed = AuthEnvironmentSchema.parse(input);
  const origin = parseBaseUrl(parsed.BETTER_AUTH_URL);

  return {
    secret: parsed.BETTER_AUTH_SECRET,
    baseUrl: origin.baseUrl,
    googleClientId: parsed.GOOGLE_CLIENT_ID,
    googleClientSecret: parsed.GOOGLE_CLIENT_SECRET,
    secureCookies: origin.secure,
  };
}

/**
 * Reports whether optional public-page session detection can safely initialize
 * the auth runtime. Protected pages and API routes intentionally use the
 * strict parser instead of this readiness check.
 */
export function hasUsableAuthEnvironment(
  input: Record<string, string | undefined>,
): boolean {
  try {
    parseAuthEnvironment(input);
    return true;
  } catch {
    return false;
  }
}

export function buildAuthPolicy(environment: AuthEnvironment) {
  return {
    errorURL: `${environment.baseUrl}/auth/error`,
    session: {
      expiresIn: AUTH_SESSION_MAX_AGE_SECONDS,
      updateAge: 60 * 60 * 24,
      cookieCache: {
        enabled: false,
      },
    },
    cookieAttributes: {
      httpOnly: true,
      secure: environment.secureCookies,
      sameSite: 'lax' as const,
      path: '/',
    },
    account: {
      encryptOAuthTokens: true,
      storeStateStrategy: 'database' as const,
      accountLinking: {
        enabled: false,
        disableImplicitLinking: true,
        allowDifferentEmails: false,
      },
    },
    google: {
      clientId: environment.googleClientId,
      clientSecret: environment.googleClientSecret,
      scopes: ['openid', 'email', 'profile'],
      disableImplicitSignUp: true,
    },
  };
}
