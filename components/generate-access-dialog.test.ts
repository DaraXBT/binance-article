import { describe, expect, it } from 'vitest';

import { generateAccessFailureMessage } from './generate-access-dialog';
import { translations } from '@/lib/i18n';

describe('generateAccessFailureMessage', () => {
  it.each([
    [{ code: 'INVALID_GENERATE_CODE', reason: 'rotated' }, 'codeChanged'],
    [{ code: 'INVALID_GENERATE_CODE', reason: 'already_used' }, 'codeInUse'],
    [{ code: 'INVALID_GENERATE_CODE', reason: 'revoked' }, 'codeRevoked'],
    [{ code: 'INVALID_GENERATE_CODE', reason: 'invalid' }, 'invalidCode'],
    [{ code: 'RATE_LIMITED' }, 'tooManyAttempts'],
  ] as const)('maps known access failures to the local %s message', (body, key) => {
    expect(generateAccessFailureMessage(400, body, translations.en.generateAccess))
      .toBe(translations.en.generateAccess[key]);
  });

  it('never exposes an unknown server error body', () => {
    const rawError = 'Gemini upstream error: secret diagnostic trace';

    const message = generateAccessFailureMessage(
      500,
      { code: 'GENERATE_ACCESS_FAILED', error: rawError },
      translations.en.generateAccess,
    );

    expect(message).toBe(translations.en.generateAccess.requestFailed);
    expect(message).not.toContain(rawError);
  });

  it('uses the selected locale for safe access-code recovery copy', () => {
    const message = generateAccessFailureMessage(
      429,
      { error: 'Too many attempts. Please try again later.' },
      translations.km.generateAccess,
    );

    expect(message).toBe(translations.km.generateAccess.tooManyAttempts);
    expect(message).not.toBe(translations.en.generateAccess.tooManyAttempts);
  });
});
