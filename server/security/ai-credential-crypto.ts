const AES_KEY_BYTES = 32;
const AES_GCM_NONCE_BYTES = 12;
const AES_GCM_TAG_BITS = 128;
const AES_GCM_TAG_BYTES = AES_GCM_TAG_BITS / 8;
const MAX_KEYRING_JSON_LENGTH = 16 * 1024;
const MAX_KEYRING_ENTRIES = 32;
const MAX_WORKSPACE_ID_LENGTH = 200;
const MAX_PLAINTEXT_BYTES = 512;

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

export type AiCredentialProvider = 'gemini';

export type AiCredentialCryptoErrorCode =
  | 'INVALID_CONTEXT'
  | 'INVALID_KEYRING'
  | 'UNKNOWN_KEY_ID'
  | 'INVALID_PLAINTEXT'
  | 'INVALID_ENCRYPTED_CREDENTIAL'
  | 'DECRYPTION_FAILED';

/**
 * Deliberately does not include any caller-provided value in its message.
 * These errors may cross service boundaries, so key material and encrypted
 * credential fields must never become part of logs or API responses.
 */
export class AiCredentialCryptoError extends Error {
  readonly code: AiCredentialCryptoErrorCode;

  constructor(code: AiCredentialCryptoErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AiCredentialCryptoError';
    this.code = code;
  }
}

export interface AiCredentialKeyring {
  readonly activeKeyId: string;
  readonly keys: ReadonlyMap<string, CryptoKey>;
}

export interface EncryptedWorkspaceAiCredential {
  readonly ciphertext: string;
  readonly nonce: string;
  readonly encryptionKeyId: string;
}

interface WorkspaceCredentialContext {
  readonly workspaceId: string;
  readonly provider: AiCredentialProvider;
}

export interface EncryptWorkspaceAiCredentialInput extends WorkspaceCredentialContext {
  readonly plaintext: string;
  readonly keyring: AiCredentialKeyring;
}

export interface DecryptWorkspaceAiCredentialInput extends WorkspaceCredentialContext {
  readonly ciphertext: string;
  readonly nonce: string;
  readonly encryptionKeyId: string;
  readonly keyring: AiCredentialKeyring;
}

export type RewrapWorkspaceAiCredentialInput = DecryptWorkspaceAiCredentialInput;

function cryptoError(
  code: AiCredentialCryptoErrorCode,
  message: string,
  cause?: unknown,
): AiCredentialCryptoError {
  return new AiCredentialCryptoError(code, message, cause === undefined ? undefined : { cause });
}

function encodeBase64Url(bytes: Uint8Array): string {
  let result = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const remaining = bytes.length - index;
    const value = (first << 16) | (second << 8) | third;

    result += BASE64URL_ALPHABET[(value >>> 18) & 63];
    result += BASE64URL_ALPHABET[(value >>> 12) & 63];
    if (remaining > 1) result += BASE64URL_ALPHABET[(value >>> 6) & 63];
    if (remaining > 2) result += BASE64URL_ALPHABET[value & 63];
  }

  return result;
}

function decodeBase64Url(value: unknown, expectedBytes: number | { min: number; max: number }): Uint8Array {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length % 4 === 1
    || !BASE64URL_PATTERN.test(value)
  ) {
    throw new TypeError('Invalid base64url value.');
  }

  const decodedLength = Math.floor((value.length * 6) / 8);
  const minimum = typeof expectedBytes === 'number' ? expectedBytes : expectedBytes.min;
  const maximum = typeof expectedBytes === 'number' ? expectedBytes : expectedBytes.max;
  if (decodedLength < minimum || decodedLength > maximum) {
    throw new TypeError('Invalid base64url length.');
  }

  const decoded = new Uint8Array(decodedLength);
  let accumulator = 0;
  let bitCount = 0;
  let outputIndex = 0;

  for (const character of value) {
    const sextet = BASE64URL_ALPHABET.indexOf(character);
    accumulator = (accumulator << 6) | sextet;
    bitCount += 6;

    if (bitCount >= 8) {
      bitCount -= 8;
      decoded[outputIndex] = (accumulator >>> bitCount) & 0xff;
      outputIndex += 1;
      accumulator &= (1 << bitCount) - 1;
    }
  }

  // Comparing the canonical encoding also rejects non-zero trailing bits.
  if (outputIndex !== decodedLength || encodeBase64Url(decoded) !== value) {
    decoded.fill(0);
    throw new TypeError('Non-canonical base64url value.');
  }

  return decoded;
}

function validateKeyId(value: unknown): value is string {
  return typeof value === 'string' && KEY_ID_PATTERN.test(value);
}

function validateContext(context: WorkspaceCredentialContext): Uint8Array {
  if (
    context.provider !== 'gemini'
    || typeof context.workspaceId !== 'string'
    || context.workspaceId.length > MAX_WORKSPACE_ID_LENGTH
    || !WORKSPACE_ID_PATTERN.test(context.workspaceId)
  ) {
    throw cryptoError('INVALID_CONTEXT', 'AI credential encryption context is invalid.');
  }

  return new TextEncoder().encode(
    `xarticle:workspace-ai-credential:v1:${context.workspaceId}:${context.provider}`,
  );
}

function getKey(keyring: AiCredentialKeyring, keyId: string): CryptoKey {
  if (!validateKeyId(keyId)) {
    throw cryptoError('INVALID_ENCRYPTED_CREDENTIAL', 'Encrypted AI credential is invalid.');
  }

  const key = keyring.keys.get(keyId);
  if (!key) {
    throw cryptoError('UNKNOWN_KEY_ID', 'AI credential encryption key is unavailable.');
  }
  return key;
}

function validateKeyringForUse(keyring: AiCredentialKeyring): void {
  if (
    !keyring
    || !validateKeyId(keyring.activeKeyId)
    || !(keyring.keys instanceof Map)
    || !keyring.keys.has(keyring.activeKeyId)
  ) {
    throw cryptoError('INVALID_KEYRING', 'AI credential keyring is invalid.');
  }
}

/**
 * Parses and imports a versioned AES keyring. JSON values must be canonical,
 * unpadded base64url encodings of exactly 32 bytes. Imported keys are
 * non-extractable and may only be used for AES-256-GCM encryption/decryption.
 */
export async function parseAiCredentialKeyring(
  keyringJson: string,
  activeKeyId: string,
): Promise<AiCredentialKeyring> {
  if (
    typeof keyringJson !== 'string'
    || keyringJson.length === 0
    || keyringJson.length > MAX_KEYRING_JSON_LENGTH
    || !validateKeyId(activeKeyId)
  ) {
    throw cryptoError('INVALID_KEYRING', 'AI credential keyring is invalid.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(keyringJson);
  } catch (error) {
    throw cryptoError('INVALID_KEYRING', 'AI credential keyring is invalid.', error);
  }

  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw cryptoError('INVALID_KEYRING', 'AI credential keyring is invalid.');
  }

  const entries = Object.entries(parsed);
  if (entries.length === 0 || entries.length > MAX_KEYRING_ENTRIES) {
    throw cryptoError('INVALID_KEYRING', 'AI credential keyring is invalid.');
  }

  const keys = new Map<string, CryptoKey>();
  try {
    for (const [keyId, encodedKey] of entries) {
      if (!validateKeyId(keyId)) {
        throw new TypeError('Invalid key ID.');
      }

      const rawKey = decodeBase64Url(encodedKey, AES_KEY_BYTES);
      try {
        const cryptoKey = await crypto.subtle.importKey(
          'raw',
          rawKey as BufferSource,
          { name: 'AES-GCM', length: AES_KEY_BYTES * 8 },
          false,
          ['encrypt', 'decrypt'],
        );
        keys.set(keyId, cryptoKey);
      } finally {
        rawKey.fill(0);
      }
    }
  } catch (error) {
    throw cryptoError('INVALID_KEYRING', 'AI credential keyring is invalid.', error);
  }

  if (!keys.has(activeKeyId)) {
    throw cryptoError('INVALID_KEYRING', 'AI credential keyring is invalid.');
  }

  return Object.freeze({ activeKeyId, keys });
}

async function encryptBytes(
  plaintext: Uint8Array,
  context: WorkspaceCredentialContext,
  keyring: AiCredentialKeyring,
): Promise<EncryptedWorkspaceAiCredential> {
  validateKeyringForUse(keyring);
  const additionalData = validateContext(context);
  const nonce = crypto.getRandomValues(new Uint8Array(AES_GCM_NONCE_BYTES));
  const key = getKey(keyring, keyring.activeKeyId);

  try {
    const encrypted = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonce as BufferSource,
        additionalData: additionalData as BufferSource,
        tagLength: AES_GCM_TAG_BITS,
      },
      key,
      plaintext as BufferSource,
    );

    return {
      ciphertext: encodeBase64Url(new Uint8Array(encrypted)),
      nonce: encodeBase64Url(nonce),
      encryptionKeyId: keyring.activeKeyId,
    };
  } catch (error) {
    throw cryptoError('INVALID_KEYRING', 'AI credential could not be encrypted.', error);
  } finally {
    nonce.fill(0);
    additionalData.fill(0);
  }
}

async function decryptBytes(input: DecryptWorkspaceAiCredentialInput): Promise<Uint8Array> {
  validateKeyringForUse(input.keyring);
  const additionalData = validateContext(input);
  const key = getKey(input.keyring, input.encryptionKeyId);
  let nonce: Uint8Array | undefined;
  let ciphertext: Uint8Array | undefined;

  try {
    nonce = decodeBase64Url(input.nonce, AES_GCM_NONCE_BYTES);
    ciphertext = decodeBase64Url(input.ciphertext, {
      min: AES_GCM_TAG_BYTES + 1,
      max: AES_GCM_TAG_BYTES + MAX_PLAINTEXT_BYTES,
    });
  } catch (error) {
    nonce?.fill(0);
    ciphertext?.fill(0);
    additionalData.fill(0);
    throw cryptoError(
      'INVALID_ENCRYPTED_CREDENTIAL',
      'Encrypted AI credential is invalid.',
      error,
    );
  }

  try {
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: nonce as BufferSource,
        additionalData: additionalData as BufferSource,
        tagLength: AES_GCM_TAG_BITS,
      },
      key,
      ciphertext as BufferSource,
    );
    return new Uint8Array(decrypted);
  } catch (error) {
    throw cryptoError('DECRYPTION_FAILED', 'AI credential could not be decrypted.', error);
  } finally {
    nonce.fill(0);
    ciphertext.fill(0);
    additionalData.fill(0);
  }
}

export async function encryptWorkspaceAiCredential(
  input: EncryptWorkspaceAiCredentialInput,
): Promise<EncryptedWorkspaceAiCredential> {
  if (typeof input.plaintext !== 'string') {
    throw cryptoError('INVALID_PLAINTEXT', 'AI credential plaintext is invalid.');
  }

  const plaintext = new TextEncoder().encode(input.plaintext);
  if (plaintext.byteLength === 0 || plaintext.byteLength > MAX_PLAINTEXT_BYTES) {
    plaintext.fill(0);
    throw cryptoError('INVALID_PLAINTEXT', 'AI credential plaintext is invalid.');
  }

  try {
    return await encryptBytes(plaintext, input, input.keyring);
  } finally {
    plaintext.fill(0);
  }
}

export async function decryptWorkspaceAiCredential(
  input: DecryptWorkspaceAiCredentialInput,
): Promise<string> {
  const plaintext = await decryptBytes(input);
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(plaintext);
  } catch (error) {
    throw cryptoError('DECRYPTION_FAILED', 'AI credential could not be decrypted.', error);
  } finally {
    plaintext.fill(0);
  }
}

/**
 * Decrypts with the record's versioned key and immediately encrypts the same
 * bytes with the current active key and a fresh nonce. No plaintext is
 * returned, logged, or included in an error.
 */
export async function rewrapWorkspaceAiCredential(
  input: RewrapWorkspaceAiCredentialInput,
): Promise<EncryptedWorkspaceAiCredential> {
  const plaintext = await decryptBytes(input);
  try {
    return await encryptBytes(plaintext, input, input.keyring);
  } finally {
    plaintext.fill(0);
  }
}
