import { z } from 'zod';

export const AUTH_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
export const TELEGRAM_OIDC_DISCOVERY_URL = 'https://oauth.telegram.org/.well-known/openid-configuration';

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
  TELEGRAM_CLIENT_ID: RequiredEnvironmentValue('TELEGRAM_CLIENT_ID'),
  TELEGRAM_CLIENT_SECRET: RequiredEnvironmentValue('TELEGRAM_CLIENT_SECRET'),
}).passthrough();

export interface AuthEnvironment {
  secret: string;
  baseUrl: string;
  googleClientId: string;
  googleClientSecret: string;
  telegramClientId: string;
  telegramClientSecret: string;
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
    telegramClientId: parsed.TELEGRAM_CLIENT_ID,
    telegramClientSecret: parsed.TELEGRAM_CLIENT_SECRET,
    secureCookies: origin.secure,
  };
}

export function buildAuthPolicy(environment: AuthEnvironment) {
  return {
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
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: true,
      },
    },
    google: {
      clientId: environment.googleClientId,
      clientSecret: environment.googleClientSecret,
      scopes: ['openid', 'email', 'profile'],
      disableImplicitSignUp: true,
    },
    telegram: {
      providerId: 'telegram',
      clientId: environment.telegramClientId,
      clientSecret: environment.telegramClientSecret,
      discoveryUrl: TELEGRAM_OIDC_DISCOVERY_URL,
      issuer: 'https://oauth.telegram.org',
      requireIssuerValidation: true,
      scopes: ['openid', 'profile'],
      pkce: true,
      disableImplicitSignUp: true,
      disableSignUp: true,
    },
  };
}

const TelegramClaimsSchema = z.object({
  sub: z.string().regex(/^\d{1,20}$/, 'Telegram subject must be a numeric user identifier.'),
  name: z.string().trim().min(1).max(200).optional(),
  preferred_username: z.string().trim().min(1).max(64).optional(),
  picture: z.string().max(2_048).optional(),
}).passthrough();

function safeHttpsImage(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

export function telegramClaimsToProfile(input: unknown) {
  const claims = TelegramClaimsSchema.parse(input);
  const displayName = claims.name ??
    (claims.preferred_username ? `@${claims.preferred_username}` : `Telegram ${claims.sub}`);

  return {
    id: claims.sub,
    name: displayName,
    // Telegram's requested scopes intentionally contain no verified email. This
    // placeholder only satisfies Better Auth's provider shape; implicit signup
    // and implicit linking remain disabled, so it is never an identity bridge.
    email: `telegram-${claims.sub}@login.invalid`,
    emailVerified: false,
    image: safeHttpsImage(claims.picture),
  };
}
