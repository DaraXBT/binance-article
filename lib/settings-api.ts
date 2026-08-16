export type SettingsErrorKind =
  | 'auth'
  | 'permission'
  | 'account-disabled'
  | 'rate-limit'
  | 'server'
  | 'network'
  | 'request'
  | 'unknown';

type SettingsApiErrorOptions = {
  status: number;
  code?: string | null;
  retryAfterSeconds?: number | null;
};

/**
 * The common error shape used by Account Settings requests.
 *
 * Keeping the response metadata on the error lets each settings section
 * choose useful recovery copy without exposing an upstream HTML response or
 * losing rate-limit timing.
 */
export class SettingsApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(message: string, options: SettingsApiErrorOptions) {
    super(message);
    this.name = 'SettingsApiError';
    this.status = options.status;
    this.code = options.code ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function retryAfterSeconds(response: Response): number | null {
  const value = response.headers.get('Retry-After')?.trim();
  if (!value) return null;

  if (/^\d+(?:\.\d+)?$/.test(value)) {
    const seconds = Number(value);
    return Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : null;
  }

  const retryAt = Date.parse(value);
  if (Number.isNaN(retryAt)) return null;
  return Math.max(0, Math.ceil((retryAt - Date.now()) / 1_000));
}

async function readJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Reads a JSON settings response without ever surfacing non-JSON proxy or
 * platform bodies. Error messages and stable codes are accepted only from a
 * JSON object; every other response uses the caller's user-safe fallback.
 */
export async function readSettingsResponse<T>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const body = await readJsonBody(response);
  const payload = isRecord(body) ? body : null;

  if (!response.ok) {
    throw new SettingsApiError(
      nonEmptyString(payload?.error) ?? fallbackMessage,
      {
        status: response.status,
        code: nonEmptyString(payload?.code),
        retryAfterSeconds: retryAfterSeconds(response),
      },
    );
  }

  if (body === null) {
    throw new SettingsApiError(fallbackMessage, {
      status: response.status,
      retryAfterSeconds: retryAfterSeconds(response),
    });
  }

  return body as T;
}

export function settingsErrorKind(error: unknown): SettingsErrorKind {
  if (error instanceof SettingsApiError) {
    const code = error.code?.toUpperCase() ?? null;

    if (
      code === 'ACCOUNT_DISABLED'
      || code === 'ACCOUNT_SUSPENDED'
      || code === 'ACCOUNT_REVOKED'
    ) {
      return 'account-disabled';
    }
    if (error.status === 401 || code === 'AUTH_REQUIRED' || code === 'UNAUTHORIZED') {
      return 'auth';
    }
    if (
      error.status === 403
      || code === 'OWNER_REQUIRED'
      || code === 'FORBIDDEN'
      || code === 'PERMISSION_DENIED'
    ) {
      return 'permission';
    }
    if (error.status === 429 || code === 'RATE_LIMITED') {
      return 'rate-limit';
    }
    if (error.status >= 500) return 'server';
    if (error.status >= 400) return 'request';
    return 'unknown';
  }

  if (error instanceof TypeError) return 'network';
  return 'unknown';
}
