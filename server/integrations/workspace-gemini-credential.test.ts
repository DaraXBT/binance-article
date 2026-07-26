import { beforeEach, describe, expect, it, vi } from 'vitest';

const repository = vi.hoisted(() => ({ find: vi.fn() }));

vi.mock('@/server/modules/workspace/ai-credential-repository', () => ({
  findWorkspaceAiCredential: repository.find,
}));

import {
  resolveWorkspaceGeminiCredential,
  WorkspaceGeminiCredentialError,
} from './workspace-gemini-credential';
import {
  encryptWorkspaceAiCredential,
  parseAiCredentialKeyring,
} from '@/server/security/ai-credential-crypto';

const WORKSPACE_ID = 'workspace_1';
const WORKSPACE_KEY = 'workspace-gemini-key-1234567890';
const KEY_ID = 'key-2026-07';
const KEYRING_JSON = JSON.stringify({
  [KEY_ID]: Buffer.alloc(32, 7).toString('base64url'),
});

function storedCredential(input: {
  enabled: boolean;
  ciphertext?: string;
  nonce?: string;
  encryptionKeyId?: string;
}) {
  const now = new Date('2026-07-26T00:00:00Z');
  return {
    id: 'credential_1',
    workspaceId: WORKSPACE_ID,
    provider: 'gemini' as const,
    ciphertext: input.ciphertext ?? 'malformed',
    nonce: input.nonce ?? 'malformed',
    encryptionKeyId: input.encryptionKeyId ?? KEY_ID,
    enabled: input.enabled,
    validatedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

describe('workspace Gemini credential resolver', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the platform key when no credential is stored', async () => {
    repository.find.mockResolvedValue(null);

    await expect(resolveWorkspaceGeminiCredential({
      database: {} as never,
      workspaceId: WORKSPACE_ID,
      environment: { GEMINI_API_KEY: 'platform-key' },
    })).resolves.toEqual({
      provider: 'gemini',
      source: 'platform',
      apiKey: 'platform-key',
    });
  });

  it('keeps the legacy GOOGLE_API_KEY alias for platform fallback', async () => {
    repository.find.mockResolvedValue(null);

    await expect(resolveWorkspaceGeminiCredential({
      database: {} as never,
      workspaceId: WORKSPACE_ID,
      environment: { GOOGLE_API_KEY: 'legacy-platform-key' },
    })).resolves.toMatchObject({
      source: 'platform',
      apiKey: 'legacy-platform-key',
    });
  });

  it('does not treat a failed credential lookup as an absent row', async () => {
    repository.find.mockRejectedValue(new Error('malformed stored row'));

    await expect(resolveWorkspaceGeminiCredential({
      database: {} as never,
      workspaceId: WORKSPACE_ID,
      environment: { GEMINI_API_KEY: 'platform-key-must-not-be-used' },
    })).rejects.toMatchObject({
      code: 'WORKSPACE_GEMINI_CONNECTION_INVALID',
      source: 'workspace',
      status: 503,
    });
  });

  it('ignores encrypted fields while the saved key is inactive', async () => {
    repository.find.mockResolvedValue(storedCredential({ enabled: false }));

    await expect(resolveWorkspaceGeminiCredential({
      database: {} as never,
      workspaceId: WORKSPACE_ID,
      environment: { GEMINI_API_KEY: 'platform-key' },
    })).resolves.toMatchObject({ source: 'platform', apiKey: 'platform-key' });
  });

  it('decrypts an enabled workspace key with workspace/provider-bound AAD', async () => {
    const keyring = await parseAiCredentialKeyring(KEYRING_JSON, KEY_ID);
    const encrypted = await encryptWorkspaceAiCredential({
      workspaceId: WORKSPACE_ID,
      provider: 'gemini',
      plaintext: WORKSPACE_KEY,
      keyring,
    });
    repository.find.mockResolvedValue(storedCredential({ enabled: true, ...encrypted }));

    await expect(resolveWorkspaceGeminiCredential({
      database: {} as never,
      workspaceId: WORKSPACE_ID,
      environment: {
        GEMINI_API_KEY: 'platform-key-must-not-be-used',
        AI_CREDENTIAL_KEYRING: KEYRING_JSON,
        AI_CREDENTIAL_ACTIVE_KEY_ID: KEY_ID,
      },
    })).resolves.toEqual({
      provider: 'gemini',
      source: 'workspace',
      apiKey: WORKSPACE_KEY,
    });
  });

  it.each([
    ['corrupt ciphertext', { AI_CREDENTIAL_KEYRING: KEYRING_JSON, AI_CREDENTIAL_ACTIVE_KEY_ID: KEY_ID }],
    ['missing keyring', {}],
  ])('fails closed for an enabled row with %s', async (_label, credentialEnvironment) => {
    repository.find.mockResolvedValue(storedCredential({ enabled: true }));

    const caught = await resolveWorkspaceGeminiCredential({
      database: {} as never,
      workspaceId: WORKSPACE_ID,
      environment: {
        GEMINI_API_KEY: 'platform-key-must-not-be-used',
        ...credentialEnvironment,
      },
    }).then(() => null, (error: unknown) => error);

    expect(caught).toBeInstanceOf(WorkspaceGeminiCredentialError);
    expect(caught).toMatchObject({
      code: 'WORKSPACE_GEMINI_CONNECTION_INVALID',
      source: 'workspace',
      status: 503,
    });
    expect(JSON.stringify(caught)).not.toContain('platform-key-must-not-be-used');
    expect(JSON.stringify(caught)).not.toContain(WORKSPACE_KEY);
  });

  it('reports missing platform configuration without inspecting a disabled row', async () => {
    repository.find.mockResolvedValue(storedCredential({ enabled: false }));

    await expect(resolveWorkspaceGeminiCredential({
      database: {} as never,
      workspaceId: WORKSPACE_ID,
      environment: {},
    })).rejects.toMatchObject({
      code: 'PLATFORM_GEMINI_UNAVAILABLE',
      source: 'platform',
      status: 503,
    });
  });

  it('fails closed when the authoritative workspace credential lookup fails', async () => {
    repository.find.mockRejectedValue(new Error('database unavailable'));

    await expect(resolveWorkspaceGeminiCredential({
      database: {} as never,
      workspaceId: WORKSPACE_ID,
      environment: { GEMINI_API_KEY: 'platform-key-must-not-be-used' },
    })).rejects.toMatchObject({
      code: 'WORKSPACE_GEMINI_CONNECTION_INVALID',
      source: 'workspace',
      status: 503,
    });
  });
});
