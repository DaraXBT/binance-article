/**
 * Pure shared-enrollment primitives.  The raw shared code is intentionally
 * never represented by a database type; callers receive it only at creation
 * or rotation time and persist the HMAC returned here.
 */

export const ENROLLMENT_CODE_LENGTH = 20;
export const ENROLLMENT_CODE_PREFIX = 'JOIN';
export const ENROLLMENT_CLAIM_TTL_MS = 15 * 60 * 1_000;
export const ENROLLMENT_RESERVATION_LEASE_MS = 5 * 60 * 1_000;
export const MAX_ACTIVE_ENROLLMENT_USERS = 10;

// Crockford's alphabet excludes I, L, O, and U to avoid transcription errors.
// The normalizer accepts the first three as their unambiguous aliases.
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const ALIAS_MAP: Record<string, string> = { I: '1', L: '1', O: '0' };
const CODE_PAYLOAD_PATTERN = new RegExp(`^[${CROCKFORD_ALPHABET}]{${ENROLLMENT_CODE_LENGTH}}$`);
const HEX_PATTERN = /^[a-f0-9]{64}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export class EnrollmentCodeInputError extends TypeError {
  constructor(message = 'Enrollment code is invalid.') {
    super(message);
    this.name = 'EnrollmentCodeInputError';
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64Url(bytes: Uint8Array): string {
  // Avoid Node's Buffer so this module can run in a Cloudflare Worker isolate.
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // btoa is available in browsers and Workers.  The fallback is useful for
  // server-side tests running on older Node versions.
  const encoded = typeof btoa === 'function'
    ? btoa(binary)
    : globalThis.Buffer
      ? globalThis.Buffer.from(bytes).toString('base64')
      : (() => { throw new Error('No base64 encoder is available.'); })();
  return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Normalize a human-entered code.  Separators, case, and Crockford aliases
 * are ignored; the optional visible JOIN prefix is not part of the secret.
 */
export function normalizeEnrollmentCode(input: string): string {
  if (typeof input !== 'string') throw new EnrollmentCodeInputError();
  let value = input.trim().toUpperCase().replace(/[\s_-]/g, '');
  if (value.startsWith(ENROLLMENT_CODE_PREFIX)) {
    value = value.slice(ENROLLMENT_CODE_PREFIX.length);
  }
  value = Array.from(value, (character) => ALIAS_MAP[character] ?? character).join('');
  if (!CODE_PAYLOAD_PATTERN.test(value)) throw new EnrollmentCodeInputError();
  return value;
}

/** Return the canonical, copy/paste-safe display form. */
export function serializeEnrollmentCode(input: string): string {
  const normalized = normalizeEnrollmentCode(input);
  const groups = normalized.match(/.{1,5}/g) ?? [];
  return `${ENROLLMENT_CODE_PREFIX}-${groups.join('-')}`;
}

function encodeCrockford(bytes: Uint8Array, length: number): string {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 13) {
    throw new EnrollmentCodeInputError('Enrollment entropy must contain at least 13 bytes.');
  }
  let accumulator = 0;
  let availableBits = 0;
  let result = '';
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    availableBits += 8;
    while (availableBits >= 5 && result.length < length) {
      availableBits -= 5;
      result += CROCKFORD_ALPHABET[(accumulator >>> availableBits) & 31];
    }
    if (result.length === length) break;
  }
  if (result.length !== length) throw new EnrollmentCodeInputError('Enrollment entropy is insufficient.');
  return result;
}

export async function hashEnrollmentCode(code: string, pepper: string): Promise<string> {
  const normalized = normalizeEnrollmentCode(code);
  if (typeof pepper !== 'string' || pepper.trim().length < 32) {
    throw new Error('ENROLLMENT_CODE_PEPPER must contain at least 32 characters.');
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`xarticle:enrollment-code:v1:${normalized}`),
  );
  return bytesToHex(new Uint8Array(signature));
}

/**
 * Deterministically derive the opaque claim value for one client attempt.
 * This lets a retried claim exchange return the same HttpOnly cookie while
 * keeping the raw value absent from persistence.
 */
export async function deriveEnrollmentClaimToken(input: {
  code: string;
  idempotencyKey: string;
  pepper: string;
}): Promise<string> {
  const normalized = normalizeEnrollmentCode(input.code);
  const idempotencyKey = input.idempotencyKey.trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    throw new EnrollmentCodeInputError('Enrollment idempotency key is invalid.');
  }
  if (input.pepper.trim().length < 32) {
    throw new Error('ENROLLMENT_CODE_PEPPER must contain at least 32 characters.');
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(input.pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(
      `xarticle:enrollment-claim-token:v1:${normalized}:${idempotencyKey}`,
    ),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

/** Hash an opaque claim cookie using a domain-separated SHA-256 digest. */
export async function hashEnrollmentClaimToken(token: string): Promise<string> {
  if (typeof token !== 'string' || !BASE64URL_PATTERN.test(token)) {
    throw new EnrollmentCodeInputError('Enrollment claim token is invalid.');
  }
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`xarticle:enrollment-claim:v1:${token}`),
  );
  return bytesToHex(new Uint8Array(digest));
}

export function createEnrollmentClaimToken(entropy?: Uint8Array): string {
  const bytes = entropy ?? randomBytes(32);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 32) {
    throw new EnrollmentCodeInputError('Enrollment claim entropy must contain 32 bytes.');
  }
  return bytesToBase64Url(bytes);
}

export async function createEnrollmentCode(input: {
  entropy?: Uint8Array;
  pepper: string;
}): Promise<{
  code: string;
  normalizedCode: string;
  codeHash: string;
  codePrefix: string;
}> {
  const normalizedCode = encodeCrockford(input.entropy ?? randomBytes(13), ENROLLMENT_CODE_LENGTH);
  return {
    code: serializeEnrollmentCode(normalizedCode),
    normalizedCode,
    codeHash: await hashEnrollmentCode(normalizedCode, input.pepper),
    codePrefix: normalizedCode.slice(0, 8),
  };
}

export function assertEnrollmentHash(value: string): string {
  if (!HEX_PATTERN.test(value)) throw new EnrollmentCodeInputError('Enrollment hash is invalid.');
  return value;
}

export function assertEnrollmentClaimToken(value: string): string {
  if (typeof value !== 'string' || !BASE64URL_PATTERN.test(value)) {
    throw new EnrollmentCodeInputError('Enrollment claim token is invalid.');
  }
  return value;
}
