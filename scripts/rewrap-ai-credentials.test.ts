import { describe, expect, it, vi } from 'vitest';

import {
  assertAiCredentialRewrapEnvironment,
  rewrapStoredAiCredentials,
  runAiCredentialRewrapCli,
} from './rewrap-ai-credentials.mjs';

const KEYRING_JSON = JSON.stringify({
  old: Buffer.alloc(32, 1).toString('base64url'),
  active: Buffer.alloc(32, 2).toString('base64url'),
});

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    ALLOW_AI_CREDENTIAL_REWRAP: '1',
    CONFIRM_AI_CREDENTIAL_REWRAP_BACKUP: '1',
    CONFIRM_AI_CREDENTIAL_WRITERS_UPDATED: '1',
    OPERATOR_DATABASE_URL: 'postgresql://localhost/xarticle',
    AI_CREDENTIAL_KEYRING: KEYRING_JSON,
    AI_CREDENTIAL_ACTIVE_KEY_ID: 'active',
    ...overrides,
  };
}

describe('AI credential rewrap operator', () => {
  it('requires explicit authorization and backup confirmation', () => {
    expect(() => assertAiCredentialRewrapEnvironment(environment({
      ALLOW_AI_CREDENTIAL_REWRAP: undefined,
    }))).toThrow(/refusing/i);
    expect(() => assertAiCredentialRewrapEnvironment(environment({
      CONFIRM_AI_CREDENTIAL_REWRAP_BACKUP: undefined,
    }))).toThrow(/backup/i);
    expect(() => assertAiCredentialRewrapEnvironment(environment({
      CONFIRM_AI_CREDENTIAL_WRITERS_UPDATED: undefined,
    }))).toThrow(/Workers/i);
    expect(() => assertAiCredentialRewrapEnvironment(environment({
      AI_CREDENTIAL_ACTIVE_KEY_ID: ' active',
    }))).toThrow(/canonical/i);
  });

  it('rewraps with compare-and-swap without returning credential fields', async () => {
    const oldCiphertext = 'old-ciphertext-must-not-be-printed';
    const newCiphertext = 'new-ciphertext-must-not-be-printed';
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const statement = strings.join(' ');
      if (/COUNT/.test(statement)) return [{ remaining: 0 }];
      if (/SELECT/.test(statement)) {
        return [{
          id: 'credential_1',
          workspaceId: 'workspace_1',
          provider: 'gemini',
          ciphertext: oldCiphertext,
          nonce: 'old-nonce',
          encryptionKeyId: 'old',
        }];
      }
      if (/UPDATE/.test(statement)) return [{ id: 'credential_1' }];
      throw new Error('Unexpected query.');
    });
    const rewrapCredential = vi.fn(async () => ({
      ciphertext: newCiphertext,
      nonce: 'new-nonce',
      encryptionKeyId: 'active',
    }));

    const result = await rewrapStoredAiCredentials({
      environment: environment(),
      createSql: () => sql,
      parseKeyring: vi.fn(async () => ({ activeKeyId: 'active', keys: new Map() })),
      rewrapCredential,
    });

    expect(result).toEqual({ rewrapped: 1, skipped: 0 });
    expect(rewrapCredential).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace_1',
      encryptionKeyId: 'old',
    }));
    expect(JSON.stringify(result)).not.toContain(oldCiphertext);
    expect(JSON.stringify(result)).not.toContain(newCiphertext);
  });

  it('fails closed when old-key rows remain after the compare-and-swap pass', async () => {
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const statement = strings.join(' ');
      if (/COUNT/.test(statement)) return [{ remaining: 1 }];
      if (/SELECT/.test(statement)) return [];
      throw new Error('Unexpected query.');
    });

    await expect(rewrapStoredAiCredentials({
      environment: environment(),
      createSql: () => sql,
      parseKeyring: vi.fn(async () => ({ activeKeyId: 'active', keys: new Map() })),
    })).rejects.toThrow(/old encryption key/i);
  });

  it('prints only a generic failure and never the underlying error', async () => {
    const log = vi.fn();
    const error = vi.fn();
    const secret = 'private-key-that-must-not-be-printed';
    await expect(runAiCredentialRewrapCli({
      rewrap: async () => { throw new Error(secret); },
      log,
      error,
    })).resolves.toBe(1);

    expect(log).not.toHaveBeenCalled();
    expect(JSON.stringify(error.mock.calls)).not.toContain(secret);
    expect(error).toHaveBeenCalledWith(
      'AI credential rewrap failed. No credential material was printed.',
    );
  });
});
