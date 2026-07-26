import { describe, expect, it } from 'vitest';

import {
  AiCredentialCryptoError,
  decryptWorkspaceAiCredential,
  encryptWorkspaceAiCredential,
  parseAiCredentialKeyring,
  rewrapWorkspaceAiCredential,
  type AiCredentialCryptoErrorCode,
} from './ai-credential-crypto';

const workspaceId = 'workspace_1';
const provider = 'gemini' as const;
const plaintext = 'workspace-test-credential-plaintext-123456789';

function keyBytes(seed: number): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_, index) => (seed + index) & 0xff);
}

function encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function decode(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

function keyringJson(entries: Record<string, Uint8Array>): string {
  return JSON.stringify(Object.fromEntries(
    Object.entries(entries).map(([keyId, bytes]) => [keyId, encode(bytes)]),
  ));
}

async function expectCryptoError(
  promise: Promise<unknown>,
  code: AiCredentialCryptoErrorCode,
): Promise<AiCredentialCryptoError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AiCredentialCryptoError);
    expect(error).toMatchObject({ code });
    return error as AiCredentialCryptoError;
  }
  throw new Error('Expected an AI credential crypto error.');
}

describe('workspace AI credential crypto', () => {
  it('imports canonical 32-byte AES keys as non-extractable AES-GCM keys', async () => {
    const keyring = await parseAiCredentialKeyring(
      keyringJson({ v1: keyBytes(1), 'v2.2026-07': keyBytes(2) }),
      'v2.2026-07',
    );

    expect(keyring.activeKeyId).toBe('v2.2026-07');
    expect([...keyring.keys.keys()]).toEqual(['v1', 'v2.2026-07']);
    expect(keyring.keys.get('v1')).toMatchObject({
      algorithm: { name: 'AES-GCM', length: 256 },
      extractable: false,
      type: 'secret',
      usages: ['encrypt', 'decrypt'],
    });
  });

  it('round trips a credential with a fresh 12-byte nonce and a 128-bit auth tag', async () => {
    const keyring = await parseAiCredentialKeyring(keyringJson({ v1: keyBytes(11) }), 'v1');

    const first = await encryptWorkspaceAiCredential({ plaintext, workspaceId, provider, keyring });
    const second = await encryptWorkspaceAiCredential({ plaintext, workspaceId, provider, keyring });

    expect(first.encryptionKeyId).toBe('v1');
    expect(decode(first.nonce)).toHaveLength(12);
    expect(decode(first.ciphertext)).toHaveLength(new TextEncoder().encode(plaintext).length + 16);
    expect(first.nonce).not.toContain('=');
    expect(first.ciphertext).not.toContain('=');
    expect(second.nonce).not.toBe(first.nonce);
    expect(second.ciphertext).not.toBe(first.ciphertext);

    await expect(decryptWorkspaceAiCredential({ ...first, workspaceId, provider, keyring }))
      .resolves.toBe(plaintext);
  });

  it('binds ciphertext to the exact versioned workspace/provider AAD', async () => {
    const rawKey = keyBytes(21);
    const keyring = await parseAiCredentialKeyring(keyringJson({ v1: rawKey }), 'v1');
    const encrypted = await encryptWorkspaceAiCredential({ plaintext, workspaceId, provider, keyring });
    const importedKey = await crypto.subtle.importKey(
      'raw',
      rawKey,
      'AES-GCM',
      false,
      ['decrypt'],
    );

    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: decode(encrypted.nonce),
        additionalData: new TextEncoder().encode(
          'xarticle:workspace-ai-credential:v1:workspace_1:gemini',
        ),
        tagLength: 128,
      },
      importedKey,
      decode(encrypted.ciphertext),
    );
    expect(new TextDecoder().decode(decrypted)).toBe(plaintext);

    const error = await expectCryptoError(
      decryptWorkspaceAiCredential({
        ...encrypted,
        workspaceId: 'workspace_2',
        provider,
        keyring,
      }),
      'DECRYPTION_FAILED',
    );
    expect(error.message).not.toContain(workspaceId);
    expect(error.message).not.toContain(plaintext);
  });

  it('fails closed when ciphertext or nonce is tampered with', async () => {
    const keyring = await parseAiCredentialKeyring(keyringJson({ v1: keyBytes(31) }), 'v1');
    const encrypted = await encryptWorkspaceAiCredential({ plaintext, workspaceId, provider, keyring });
    const ciphertext = decode(encrypted.ciphertext);
    ciphertext[0] ^= 0x80;
    const nonce = decode(encrypted.nonce);
    nonce[0] ^= 0x80;

    await expectCryptoError(
      decryptWorkspaceAiCredential({
        ...encrypted,
        ciphertext: encode(ciphertext),
        workspaceId,
        provider,
        keyring,
      }),
      'DECRYPTION_FAILED',
    );
    await expectCryptoError(
      decryptWorkspaceAiCredential({
        ...encrypted,
        nonce: encode(nonce),
        workspaceId,
        provider,
        keyring,
      }),
      'DECRYPTION_FAILED',
    );
  });

  it('rejects unknown version IDs instead of trying the active key', async () => {
    const keyring = await parseAiCredentialKeyring(keyringJson({ v2: keyBytes(41) }), 'v2');

    const error = await expectCryptoError(
      decryptWorkspaceAiCredential({
        ciphertext: encode(new Uint8Array(17)),
        nonce: encode(new Uint8Array(12)),
        encryptionKeyId: 'retired-v1',
        workspaceId,
        provider,
        keyring,
      }),
      'UNKNOWN_KEY_ID',
    );
    expect(error.message).not.toContain('retired-v1');
  });

  it('rewraps an old version directly to the active key with a fresh nonce', async () => {
    const oldKey = keyBytes(51);
    const newKey = keyBytes(61);
    const oldKeyring = await parseAiCredentialKeyring(keyringJson({ v1: oldKey }), 'v1');
    const encryptedWithOldKey = await encryptWorkspaceAiCredential({
      plaintext,
      workspaceId,
      provider,
      keyring: oldKeyring,
    });
    const rotatingKeyring = await parseAiCredentialKeyring(
      keyringJson({ v1: oldKey, v2: newKey }),
      'v2',
    );

    const rewrapped = await rewrapWorkspaceAiCredential({
      ...encryptedWithOldKey,
      workspaceId,
      provider,
      keyring: rotatingKeyring,
    });

    expect(rewrapped.encryptionKeyId).toBe('v2');
    expect(rewrapped.nonce).not.toBe(encryptedWithOldKey.nonce);
    expect(JSON.stringify(rewrapped)).not.toContain(plaintext);

    const newOnlyKeyring = await parseAiCredentialKeyring(keyringJson({ v2: newKey }), 'v2');
    await expect(decryptWorkspaceAiCredential({
      ...rewrapped,
      workspaceId,
      provider,
      keyring: newOnlyKeyring,
    })).resolves.toBe(plaintext);
    await expectCryptoError(
      decryptWorkspaceAiCredential({
        ...encryptedWithOldKey,
        workspaceId,
        provider,
        keyring: newOnlyKeyring,
      }),
      'UNKNOWN_KEY_ID',
    );
  });

  it.each([
    ['invalid JSON', '{'],
    ['JSON null', 'null'],
    ['JSON array', '[]'],
    ['empty object', '{}'],
    ['non-string key', JSON.stringify({ v1: 123 })],
    ['short key', JSON.stringify({ v1: encode(new Uint8Array(31)) })],
    ['long key', JSON.stringify({ v1: encode(new Uint8Array(33)) })],
    ['padded base64', JSON.stringify({ v1: `${encode(new Uint8Array(32))}=` })],
    ['invalid key ID', JSON.stringify({ 'bad key id': encode(new Uint8Array(32)) })],
  ])('rejects a malformed keyring: %s', async (_label, serialized) => {
    await expectCryptoError(parseAiCredentialKeyring(serialized, 'v1'), 'INVALID_KEYRING');
  });

  it('rejects a missing active version and bounded keyring overflows', async () => {
    await expectCryptoError(
      parseAiCredentialKeyring(keyringJson({ v1: keyBytes(71) }), 'v2'),
      'INVALID_KEYRING',
    );

    const tooManyEntries = Object.fromEntries(
      Array.from({ length: 33 }, (_, index) => [`v${index}`, keyBytes(index)]),
    );
    await expectCryptoError(
      parseAiCredentialKeyring(keyringJson(tooManyEntries), 'v1'),
      'INVALID_KEYRING',
    );

    await expectCryptoError(
      parseAiCredentialKeyring(' '.repeat((16 * 1024) + 1), 'v1'),
      'INVALID_KEYRING',
    );
  });

  it.each([
    ['padded nonce', { nonce: `${encode(new Uint8Array(12))}=` }],
    ['short nonce', { nonce: encode(new Uint8Array(11)) }],
    ['short ciphertext', { ciphertext: encode(new Uint8Array(16)) }],
    ['non-base64 ciphertext', { ciphertext: 'not+base64' }],
  ])('rejects malformed encrypted storage: %s', async (_label, override) => {
    const keyring = await parseAiCredentialKeyring(keyringJson({ v1: keyBytes(81) }), 'v1');
    const error = await expectCryptoError(
      decryptWorkspaceAiCredential({
        ciphertext: encode(new Uint8Array(17)),
        nonce: encode(new Uint8Array(12)),
        encryptionKeyId: 'v1',
        workspaceId,
        provider,
        keyring,
        ...override,
      }),
      'INVALID_ENCRYPTED_CREDENTIAL',
    );
    expect(error.message).not.toContain(JSON.stringify(override));
  });

  it('bounds plaintext and rejects invalid encryption contexts', async () => {
    const keyring = await parseAiCredentialKeyring(keyringJson({ v1: keyBytes(91) }), 'v1');

    await expectCryptoError(
      encryptWorkspaceAiCredential({ plaintext: '', workspaceId, provider, keyring }),
      'INVALID_PLAINTEXT',
    );
    await expectCryptoError(
      encryptWorkspaceAiCredential({ plaintext: 'x'.repeat(513), workspaceId, provider, keyring }),
      'INVALID_PLAINTEXT',
    );
    await expectCryptoError(
      encryptWorkspaceAiCredential({
        plaintext,
        workspaceId: 'workspace:ambiguous',
        provider,
        keyring,
      }),
      'INVALID_CONTEXT',
    );
  });
});
