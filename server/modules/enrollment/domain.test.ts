import { describe, expect, it } from 'vitest';

import {
  ENROLLMENT_CODE_LENGTH,
  createEnrollmentCode,
  deriveEnrollmentClaimToken,
  hashEnrollmentClaimToken,
  hashEnrollmentCode,
  normalizeEnrollmentCode,
  serializeEnrollmentCode,
} from './domain';

describe('enrollment code domain', () => {
  it('normalizes the displayed JOIN code without changing its secret payload', () => {
    expect(normalizeEnrollmentCode(' join-01234-56789-abcde-fghjk '))
      .toBe('0123456789ABCDEFGHJK');
    expect(normalizeEnrollmentCode('OIL01-23456-789AB-CDEFG'))
      .toBe('0110123456789ABCDEFG');
  });

  it('rejects malformed, short, and non-Crockford codes', () => {
    expect(() => normalizeEnrollmentCode('JOIN-1234')).toThrow();
    expect(() => normalizeEnrollmentCode('JOIN-01234-56789-ABCDE-FGH!K')).toThrow();
    expect(() => normalizeEnrollmentCode('JOIN-01234-56789-ABCDE-FGHUK')).toThrow();
  });

  it('creates a deterministic 20-character code from supplied entropy', async () => {
    const entropy = new Uint8Array(13);
    const result = await createEnrollmentCode({ entropy, pepper: 'p'.repeat(32) });

    expect(result.normalizedCode).toHaveLength(ENROLLMENT_CODE_LENGTH);
    expect(result.code).toMatch(/^JOIN(?:-[0-9A-Z]{5}){4}$/);
    expect(result.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.codePrefix).toBe(result.normalizedCode.slice(0, 8));
    expect(serializeEnrollmentCode(result.normalizedCode)).toBe(result.code);
    expect(result.code).not.toContain(result.codeHash);
  });

  it('uses a peppered HMAC and never treats the raw code as its persisted value', async () => {
    const code = normalizeEnrollmentCode('JOIN-01234-56789-ABCDE-FGHJK');
    const first = await hashEnrollmentCode(code, 'a'.repeat(32));
    const second = await hashEnrollmentCode(code, 'b'.repeat(32));
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain(code);
  });

  it('hashes opaque claim tokens separately from enrollment codes', async () => {
    const token = 'A'.repeat(43);
    const hash = await hashEnrollmentClaimToken(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(token);
    expect(hash).not.toBe(await hashEnrollmentCode(
      normalizeEnrollmentCode('JOIN-01234-56789-ABCDE-FGHJK'),
      'a'.repeat(32),
    ));
  });

  it('derives a stable opaque claim for safe idempotent exchanges', async () => {
    const first = await deriveEnrollmentClaimToken({
      code: 'JOIN-01234-56789-ABCDE-FGHJK',
      idempotencyKey: 'attempt-12345678',
      pepper: 'a'.repeat(32),
    });
    const replay = await deriveEnrollmentClaimToken({
      code: '0123456789ABCDEFGHJK',
      idempotencyKey: 'attempt-12345678',
      pepper: 'a'.repeat(32),
    });
    const otherAttempt = await deriveEnrollmentClaimToken({
      code: 'JOIN-01234-56789-ABCDE-FGHJK',
      idempotencyKey: 'attempt-87654321',
      pepper: 'a'.repeat(32),
    });

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(replay).toBe(first);
    expect(otherAttempt).not.toBe(first);
    expect(first).not.toContain('attempt-12345678');
  });
});
