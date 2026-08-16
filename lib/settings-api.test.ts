import { describe, expect, it } from 'vitest';

import {
  SettingsApiError,
  readSettingsResponse,
  settingsErrorKind,
} from './settings-api';

describe('Settings API errors', () => {
  it('retains a JSON error code and retry timing', async () => {
    const response = new Response(JSON.stringify({
      error: 'Try again later.',
      code: 'RATE_LIMITED',
    }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': '45',
      },
    });

    await expect(readSettingsResponse(response, 'Request failed.')).rejects.toMatchObject({
      name: 'SettingsApiError',
      message: 'Try again later.',
      code: 'RATE_LIMITED',
      status: 429,
      retryAfterSeconds: 45,
    });
  });

  it('classifies a non-JSON Cloudflare response by HTTP status', async () => {
    const response = new Response('<html>rate limited</html>', {
      status: 429,
      headers: { 'Content-Type': 'text/html' },
    });

    let caught: unknown;
    try {
      await readSettingsResponse(response, 'Publishing computers could not be loaded.');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SettingsApiError);
    expect(caught).toMatchObject({
      message: 'Publishing computers could not be loaded.',
      code: null,
      status: 429,
    });
    expect(settingsErrorKind(caught)).toBe('rate-limit');
  });

  it.each([
    [401, 'AUTH_REQUIRED', 'auth'],
    [403, 'OWNER_REQUIRED', 'permission'],
    [403, 'ACCOUNT_DISABLED', 'account-disabled'],
    [500, 'INTERNAL_ERROR', 'server'],
  ] as const)('classifies status %s and code %s as %s', (status, code, kind) => {
    expect(settingsErrorKind(new SettingsApiError('Failure', {
      status,
      code,
      retryAfterSeconds: null,
    }))).toBe(kind);
  });

  it('classifies fetch failures as network failures', () => {
    expect(settingsErrorKind(new TypeError('Failed to fetch'))).toBe('network');
  });
});
